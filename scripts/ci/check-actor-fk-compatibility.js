#!/usr/bin/env node
/**
 * GOV-H — FK / NOT NULL / CHECK compatibility detector (DEFECT-008 class).
 *
 * THE DEFECT CLASS, mechanically:
 *   An `ON DELETE SET NULL` foreign key on a column that cannot hold NULL.
 *   The FK promises to write NULL into the column when the parent row is
 *   deleted; the column refuses it. The delete then fails at runtime — or,
 *   worse, a sibling UPDATE fails later, because PostgreSQL re-evaluates EVERY
 *   table CHECK on an updated row, so a row whose actor column is already NULL
 *   becomes permanently un-updatable.
 *
 *   Two ways the column cannot hold NULL:
 *     (1) the column is declared NOT NULL            → `set_null_on_not_null`
 *     (2) a CHECK constraint on the table requires it non-NULL for some rows
 *         (e.g. `CHECK (origin = 'human' AND actor IS NOT NULL OR …)`)
 *                                                     → `set_null_vs_check`
 *   Both are visible in the catalog. Neither is visible to a unit test with a
 *   mocked database, which is why this class reached production twice.
 *
 * IMMUTABLE ACTOR ATTRIBUTION — the other half of the programme. An actor
 * column records WHO did something. That fact does not stop being true when
 * the actor's user row is deleted, so the column must NOT carry an FK into
 * public.users at all: SET NULL erases the attribution, CASCADE erases the
 * evidence. The declarative register of those columns, and of the writer that
 * must validate the referent instead, is
 * `scripts/migrations/actor-field-registry.json`. This script is what makes
 * that register true rather than aspirational: it fails when the catalog and
 * the register disagree, in EITHER direction.
 *
 * TWO INPUTS, ONE ANALYZER — the analyzer is pure; only the adapters do I/O.
 *
 *   --baseline (default)  parse the committed schema-only dump
 *                         `supabase/_schema/baseline.sql`. No database, no
 *                         network, no secrets, deterministic. Safe in a
 *                         required status check.
 *                         LIMIT: the baseline is a point-in-time dump
 *                         (see baseline.json `ledgerMax`). Tables created by
 *                         migrations NEWER than that are NOT in it and are
 *                         therefore NOT covered. The script reports the
 *                         boundary so the blind spot is never silent.
 *
 *   --db <url>            read pg_catalog on an already-materialised schema —
 *                         the real-schema CI database AFTER migration replay,
 *                         or a disposable local clone. This is the path that
 *                         covers post-baseline tables.
 *                         REFUSES a non-local host unless
 *                         ACTOR_FK_ALLOW_REMOTE=1 is set, so it cannot be
 *                         pointed at production by an inherited env var.
 *
 * Read-only throughout: pg_catalog SELECTs, nothing else. Exit 0 = clean,
 * exit 1 = findings at or above the failure severity.
 *
 * Run:
 *   node scripts/ci/check-actor-fk-compatibility.js
 *   node scripts/ci/check-actor-fk-compatibility.js --db postgresql://…/w6_x
 *   node scripts/ci/check-actor-fk-compatibility.js --json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const BASELINE_SQL = path.join(REPO, 'supabase', '_schema', 'baseline.sql');
const BASELINE_META = path.join(REPO, 'supabase', '_schema', 'baseline.json');
const REGISTRY = path.join(REPO, 'scripts', 'migrations', 'actor-field-registry.json');
const KNOWN = path.join(REPO, 'scripts', 'migrations', 'set-null-known-defects.json');

// ───────────────────────── catalog model ─────────────────────────
/**
 * @typedef {{ notNull: boolean, type: string }} Column
 * @typedef {{ name: string, definition: string }} Check
 * @typedef {{ columns: Map<string, Column>, checks: Check[] }} Table
 * @typedef {{ name: string, table: string, columns: string[], refSchema: string,
 *             refTable: string, refColumns: string[], onDelete: string,
 *             setNullColumns: string[]|null }} ForeignKey
 * @typedef {{ tables: Map<string, Table>, foreignKeys: ForeignKey[], source: string,
 *             coverage: { tables: number, foreignKeys: number, boundary: string|null } }} Catalog
 */

// ───────────────────────── baseline.sql adapter ─────────────────────────

/**
 * Split a CREATE TABLE body into its top-level items (columns and inline
 * table constraints), respecting parentheses and single-quoted literals.
 * A naive `split(',')` tears `CHECK (x = ANY (ARRAY['a','b']))` apart.
 */
function splitTopLevel(body) {
  const items = [];
  let depth = 0;
  let inQuote = false;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      buf += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") { buf += body[++i]; continue; } // escaped ''
        inQuote = false;
      }
      continue;
    }
    if (ch === "'") { inQuote = true; buf += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) items.push(buf.trim());
  return items;
}

/** Remove quoted literals and parenthesised groups, so keyword tests cannot
 *  match inside a DEFAULT expression or a CHECK body. Length is not preserved. */
function outerOnly(item) {
  let out = '';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (inQuote) {
      if (ch === "'") { if (item[i + 1] === "'") { i++; continue; } inQuote = false; }
      continue;
    }
    if (ch === "'") { inQuote = true; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

const unquote = (s) => String(s).trim().replace(/^"(.*)"$/, '$1');
const splitIdents = (s) => String(s).split(',').map(unquote).filter(Boolean);

/** Normalise an ON DELETE action to the pg_catalog spelling. */
function normalizeAction(raw) {
  if (!raw) return 'NO ACTION';
  const a = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (a.startsWith('SET NULL')) return 'SET NULL';
  if (a.startsWith('SET DEFAULT')) return 'SET DEFAULT';
  if (a === 'CASCADE' || a === 'RESTRICT' || a === 'NO ACTION') return a;
  return a;
}

/**
 * Parse a schema-only pg_dump into the catalog model. Text parsing, not a
 * restore — the same decision `check-schema-baseline-drift.js` already makes,
 * so this needs no container and no database.
 * @returns {Catalog}
 */
function parseBaselineCatalog(sql, { source = 'baseline', boundary = null } = {}) {
  const tables = new Map();

  // CREATE TABLE public.x (\n … \n);  — pg_dump always terminates with `\n);`
  const createRe = /^CREATE TABLE (?:IF NOT EXISTS )?(?:("?[A-Za-z0-9_]+"?)\.)?("?[A-Za-z0-9_]+"?) \(\n([\s\S]*?)\n\);/gm;
  for (const m of sql.matchAll(createRe)) {
    const schema = m[1] ? unquote(m[1]) : 'public';
    if (schema !== 'public') continue;
    const table = unquote(m[2]);
    const columns = new Map();
    const checks = [];
    for (const item of splitTopLevel(m[3])) {
      const cons = /^CONSTRAINT\s+("?[A-Za-z0-9_]+"?)\s+([\s\S]*)$/i.exec(item);
      if (cons) {
        const body = cons[2].trim();
        if (/^CHECK\b/i.test(body)) checks.push({ name: unquote(cons[1]), definition: body });
        continue;
      }
      if (/^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(item)) {
        if (/^CHECK\b/i.test(item)) checks.push({ name: '', definition: item });
        continue;
      }
      const col = /^("?[A-Za-z0-9_]+"?)\s+([\s\S]+)$/.exec(item);
      if (!col) continue;
      const outer = outerOnly(item);
      columns.set(unquote(col[1]), {
        notNull: /\bNOT\s+NULL\b/i.test(outer),
        type: col[2].replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
    tables.set(table, { columns, checks });
  }

  // CHECK constraints added separately (pg_dump emits most inline, a few not).
  const addCheckRe =
    /ALTER TABLE (?:ONLY )?(?:("?[A-Za-z0-9_]+"?)\.)?("?[A-Za-z0-9_]+"?)\s*\n?\s*ADD CONSTRAINT ("?[A-Za-z0-9_]+"?) (CHECK[\s\S]*?);/g;
  for (const m of sql.matchAll(addCheckRe)) {
    const schema = m[1] ? unquote(m[1]) : 'public';
    if (schema !== 'public') continue;
    const t = tables.get(unquote(m[2]));
    if (t) t.checks.push({ name: unquote(m[3]), definition: m[4].trim() });
  }

  // Foreign keys.
  const foreignKeys = [];
  const fkRe =
    /ALTER TABLE (?:ONLY )?(?:("?[A-Za-z0-9_]+"?)\.)?("?[A-Za-z0-9_]+"?)\s*\n?\s*ADD CONSTRAINT ("?[A-Za-z0-9_]+"?) FOREIGN KEY \(([^)]*)\) REFERENCES (?:("?[A-Za-z0-9_]+"?)\.)?("?[A-Za-z0-9_]+"?)\(([^)]*)\)([^;]*);/g;
  for (const m of sql.matchAll(fkRe)) {
    const schema = m[1] ? unquote(m[1]) : 'public';
    if (schema !== 'public') continue;
    const tail = m[8] || '';
    // `ON DELETE SET NULL (col, …)` — PostgreSQL 15 partial SET NULL.
    const onDel = /\bON\s+DELETE\s+(SET\s+NULL|SET\s+DEFAULT|CASCADE|RESTRICT|NO\s+ACTION)\s*(\(([^)]*)\))?/i.exec(tail);
    foreignKeys.push({
      name: unquote(m[3]),
      table: unquote(m[2]),
      columns: splitIdents(m[4]),
      refSchema: m[5] ? unquote(m[5]) : 'public',
      refTable: unquote(m[6]),
      refColumns: splitIdents(m[7]),
      onDelete: normalizeAction(onDel ? onDel[1] : null),
      setNullColumns: onDel && onDel[3] ? splitIdents(onDel[3]) : null,
    });
  }

  return {
    tables,
    foreignKeys,
    source,
    coverage: { tables: tables.size, foreignKeys: foreignKeys.length, boundary },
  };
}

// ───────────────────────── pg_catalog adapter ─────────────────────────

/**
 * Normalise a value node-postgres may hand back either as a JS array or, when
 * no parser is registered for the element type's OID, as the raw Postgres
 * array literal string `{a,b}`. Belt and braces behind the `::text` casts.
 */
function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  const inner = v.replace(/^\{/, '').replace(/\}$/, '');
  if (inner === '') return [];
  return inner.split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** Refuse a non-loopback target unless explicitly allowed. The detector is
 *  read-only, but "read-only against production" is still a forbidden
 *  connection in this programme, and an inherited DATABASE_URL must not be
 *  able to redirect it. */
function assertLocalTarget(url) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error('--db is not a valid URL'); }
  if (LOCAL_HOSTS.has(host) || process.env.ACTOR_FK_ALLOW_REMOTE === '1') return host;
  throw new Error(
    `refusing to connect to non-loopback host '${host}'. This detector is for the CI/disposable schema. ` +
    'Set ACTOR_FK_ALLOW_REMOTE=1 only for a database you have been authorised to read.',
  );
}

async function readPgCatalog(url) {
  assertLocalTarget(url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, application_name: 'actor-fk-compatibility' });
  await client.connect();
  try {
    const cols = await client.query(
      `SELECT c.relname AS table_name, a.attname AS column_name, a.attnotnull AS not_null,
              format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    const tables = new Map();
    for (const r of cols.rows) {
      if (!tables.has(r.table_name)) tables.set(r.table_name, { columns: new Map(), checks: [] });
      tables.get(r.table_name).columns.set(r.column_name, { notNull: r.not_null === true, type: r.type });
    }
    const checks = await client.query(
      `SELECT c.relname AS table_name, con.conname AS name, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'c'`,
    );
    for (const r of checks.rows) {
      const t = tables.get(r.table_name);
      if (t) t.checks.push({ name: r.name, definition: r.definition });
    }
    // `a.attname` is type `name`, NOT text, so array_agg over it yields name[]
    // (OID 1003). node-postgres has no parser registered for that OID and
    // hands back the RAW Postgres array literal — the STRING '{user_id}'.
    // Iterating that string yields characters, every column lookup misses, and
    // the detector reports a clean catalog.
    //
    // It did exactly that, against a real 870-FK schema: six contradictions it
    // finds correctly from the committed dump became ZERO findings, and the run
    // looked like a pass. Hence the `::text` casts, plus toArray() and the hard
    // invariant below. A gate that cannot fail is worse than no gate.
    const fks = await client.query(
      `SELECT con.conname AS name, c.relname AS table_name, rn.nspname AS ref_schema,
              rc.relname AS ref_table, con.confdeltype AS del_type,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols,
              (SELECT array_agg(a.attname::text)
                 FROM unnest(COALESCE(con.confdelsetcols, '{}'::smallint[])) AS k(attnum)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS set_null_cols
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'f'`,
    );
    const DEL = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
    const foreignKeys = fks.rows.map((r) => ({
      name: r.name,
      table: r.table_name,
      columns: toArray(r.cols),
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumns: toArray(r.ref_cols),
      onDelete: DEL[r.del_type] || 'NO ACTION',
      setNullColumns: toArray(r.set_null_cols).length ? toArray(r.set_null_cols) : null,
    }));
    // HARD INVARIANT. Every foreign key constrains at least one column. If a
    // driver type-parsing change ever breaks the array decoding again, this
    // throws instead of letting the run report a clean catalog.
    const malformed = foreignKeys.filter((f) => !Array.isArray(f.columns) || f.columns.length === 0);
    if (malformed.length) {
      throw new Error(
        `pg_catalog read is malformed: ${malformed.length} foreign key(s) decoded with no columns ` +
        `(first: ${malformed[0].name} on ${malformed[0].table}, columns=${JSON.stringify(malformed[0].columns)}). ` +
        'Refusing to report a result that would look clean.',
      );
    }
    return {
      tables,
      foreignKeys,
      source: `pg_catalog@${new URL(url).hostname}:${new URL(url).port || 5432}/${new URL(url).pathname.slice(1)}`,
      coverage: { tables: tables.size, foreignKeys: foreignKeys.length, boundary: null },
    };
  } finally {
    await client.end();
  }
}

// ───────────────────────── the analyzer (pure) ─────────────────────────

const SEVERITY_ORDER = { error: 2, warn: 1, info: 0 };

/**
 * Column names a CHECK constraint requires to be non-NULL for at least some
 * rows. `<col> IS NOT NULL` anywhere in a CHECK means there is a row shape the
 * constraint will reject once the column is NULL. That is exactly the
 * `ppo_origin_actor` shape, and it is why `ON DELETE SET NULL` on such a column
 * is a latent, delayed failure rather than an immediate one.
 */
function columnsRequiredNonNullByCheck(check) {
  const found = new Set();
  const def = String(check.definition || '');
  for (const m of def.matchAll(/(?:^|[^A-Za-z0-9_."])"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(?:::[A-Za-z_][\w ]*)?\s+IS\s+NOT\s+NULL/gi)) {
    found.add(m[1].toLowerCase());
  }
  return found;
}

/** Actor-attribution naming, used only for ADVISORY findings. */
const ACTOR_NAME_RE = /(^|_)(recorded_by|created_by|updated_by|deleted_by|reviewed_by|approved_by|granted_by|assigned_by|archived_by|resolved_by|actor|performed_by|requested_by|acknowledged_by|triggered_by)(_user_id|_by|_id)?$/;

function looksLikeActorColumn(col) {
  const c = col.toLowerCase();
  return ACTOR_NAME_RE.test(c) || /_by$/.test(c) || /^actor_/.test(c);
}

/**
 * The analyzer. Pure: catalog + registry in, findings out. No I/O, no clock,
 * no randomness — identical input always yields identical, sorted output.
 *
 * @param {Catalog} catalog
 * @param {{ columns: Array<object> }} registry
 */
function detect(catalog, registry = { columns: [] }, known = []) {
  const findings = [];
  const add = (f) => findings.push(f);
  const decl = new Map();
  for (const d of registry.columns || []) decl.set(`${d.table}.${d.column}`, d);
  const seenDeclared = new Set();

  for (const fk of catalog.foreignKeys) {
    const table = catalog.tables.get(fk.table);
    // Which columns does this FK actually null out on delete?
    const nulled =
      fk.onDelete !== 'SET NULL' ? [] : (fk.setNullColumns && fk.setNullColumns.length ? fk.setNullColumns : fk.columns);

    for (const column of nulled) {
      const col = table && table.columns.get(column);

      // ── R1 set_null_on_not_null — the mechanical contradiction.
      if (col && col.notNull) {
        add({
          rule: 'set_null_on_not_null',
          severity: 'error',
          table: fk.table,
          column,
          constraint: fk.name,
          references: `${fk.refSchema}.${fk.refTable}(${fk.refColumns.join(', ')})`,
          detail:
            `FK ${fk.name} is ON DELETE SET NULL but ${fk.table}.${column} is NOT NULL. ` +
            'Deleting the referenced row raises 23502 — the delete can never succeed. ' +
            'Choose one: make the column nullable, drop the FK and validate the referent in the writer ' +
            '(immutable actor attribution), or change the action to RESTRICT/NO ACTION.',
        });
      }

      // ── R2 set_null_vs_check — the delayed, far nastier variant.
      for (const check of (table ? table.checks : [])) {
        if (!columnsRequiredNonNullByCheck(check).has(column.toLowerCase())) continue;
        add({
          rule: 'set_null_vs_check',
          severity: 'error',
          table: fk.table,
          column,
          constraint: fk.name,
          check: check.name || '(unnamed)',
          detail:
            `FK ${fk.name} is ON DELETE SET NULL on ${fk.table}.${column}, but CHECK ` +
            `${check.name || '(unnamed)'} requires that column to be non-NULL for some rows. ` +
            'The delete succeeds or fails depending on the row, and any row left NULL becomes ' +
            'permanently un-updatable (an UPDATE re-evaluates every table CHECK). ' +
            'This is the DEFECT-008 shape.',
        });
      }
    }
  }

  // ── R3/R4/R5 — the declarative register must match the catalog, both ways.
  for (const fk of catalog.foreignKeys) {
    for (const column of fk.columns) {
      const key = `${fk.table}.${column}`;
      const d = decl.get(key);
      if (!d) continue;
      seenDeclared.add(key);
      if (d.immutable_actor !== true) continue;
      const isUsersRef = fk.refTable === 'users';
      if (!isUsersRef) continue;
      if (fk.onDelete === 'SET NULL') {
        add({
          rule: 'immutable_actor_set_null_fk',
          severity: 'error',
          table: fk.table,
          column,
          constraint: fk.name,
          detail:
            `${key} is declared immutable actor attribution in actor-field-registry.json, but ` +
            `FK ${fk.name} is ON DELETE SET NULL — deleting the user ERASES the attribution. ` +
            'Drop the FK and validate the referent in the writer.',
        });
      } else if (fk.onDelete === 'CASCADE') {
        add({
          rule: 'immutable_actor_cascade_fk',
          severity: 'error',
          table: fk.table,
          column,
          constraint: fk.name,
          detail:
            `${key} is declared immutable actor attribution, but FK ${fk.name} is ON DELETE CASCADE — ` +
            'deleting the user DELETES the attributed records. Drop the FK and validate in the writer.',
        });
      } else if (d.fk_into_users === 'absent') {
        add({
          rule: 'immutable_actor_unexpected_fk',
          severity: 'error',
          table: fk.table,
          column,
          constraint: fk.name,
          detail:
            `actor-field-registry.json records that ${key} must carry NO foreign key into public.users ` +
            `(the writer validates the referent instead), but FK ${fk.name} (${fk.onDelete}) exists. ` +
            'Either the registry is stale or a migration reintroduced the FK.',
        });
      }
    }
  }

  // Registry entries whose column does not exist, or whose declared absent FK
  // is genuinely absent (that is the good case — recorded, not a finding).
  for (const [key, d] of decl) {
    const [t, c] = key.split('.');
    const table = catalog.tables.get(t);
    if (!table) {
      add({
        rule: 'registry_table_not_in_catalog',
        severity: 'info',
        table: t,
        column: c,
        detail:
          `actor-field-registry.json declares ${key}, but table public.${t} is not in this catalog ` +
          `(${catalog.source}${catalog.coverage.boundary ? `, boundary ${catalog.coverage.boundary}` : ''}). ` +
          'NOT a pass for this column — run the --db path against a replayed schema to cover it.',
      });
      continue;
    }
    if (!table.columns.has(c)) {
      // A point-in-time dump CANNOT prove a column is absent: the table may
      // predate the boundary while the column was added by a later migration
      // (exactly source_assertions.asserted_by_user_id, added by
      // 20261122000000, against a baseline at 20260916000000). Absence is only
      // evidence on a live catalog, so the severity follows the input.
      const provable = !catalog.coverage.boundary;
      add({
        rule: 'registry_column_missing',
        severity: provable ? 'error' : 'info',
        table: t,
        column: c,
        detail: provable
          ? `actor-field-registry.json declares ${key}, but column ${c} does not exist on public.${t}. The registry is a lie.`
          : `actor-field-registry.json declares ${key}; public.${t} is in this catalog but column ${c} is not. ` +
            `This catalog is a point-in-time dump at ledger position ${catalog.coverage.boundary}, which cannot ` +
            'prove a column is absent — a later migration may add it. NOT a pass: run the --db path to decide.',
      });
      continue;
    }
    // A declared-immutable actor column must be nullable: the whole point is
    // that attribution survives without a referent, and a NOT NULL column with
    // no FK cannot be left unset by a writer that legitimately has no actor.
    if (d.immutable_actor === true && d.nullable === true && table.columns.get(c).notNull) {
      add({
        rule: 'registry_nullability_mismatch',
        severity: 'error',
        table: t,
        column: c,
        detail: `actor-field-registry.json declares ${key} nullable, but the catalog says NOT NULL.`,
      });
    }
    if (d.immutable_actor === true && d.nullable === false && !table.columns.get(c).notNull) {
      add({
        rule: 'registry_nullability_mismatch',
        severity: 'error',
        table: t,
        column: c,
        detail: `actor-field-registry.json declares ${key} NOT NULL, but the catalog says nullable.`,
      });
    }
  }

  // ── R6 undeclared actor FK into users with an erasing action (ADVISORY).
  //    Naming heuristics must never fail a build, so this is `info`: it is a
  //    worklist for the owner, not a gate.
  for (const fk of catalog.foreignKeys) {
    if (fk.refTable !== 'users') continue;
    if (fk.onDelete !== 'SET NULL' && fk.onDelete !== 'CASCADE') continue;
    for (const column of fk.columns) {
      const key = `${fk.table}.${column}`;
      if (decl.has(key)) continue;
      if (!looksLikeActorColumn(column)) continue;
      add({
        rule: 'undeclared_actor_fk',
        severity: 'info',
        table: fk.table,
        column,
        constraint: fk.name,
        detail:
          `${key} looks like actor attribution (ON DELETE ${fk.onDelete} into public.users) but is not in ` +
          'actor-field-registry.json. Decide explicitly: immutable attribution (drop the FK, validate in the ' +
          'writer) or ordinary ownership (record it as `immutable_actor: false`). Advisory — naming is a hint, not proof.',
      });
    }
  }

  findings.sort((a, b) =>
    (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) ||
    a.rule.localeCompare(b.rule) || a.table.localeCompare(b.table) || a.column.localeCompare(b.column));

  // ── Acknowledged, not forgiven. Six contradictions already exist in the
  //    committed baseline; every one is owned by a track or awaiting routing,
  //    and every one is in a table this script must not change. Freezing them
  //    is what lets this run as a BLOCKING required check today instead of
  //    being switched off. They are printed on every run with their owner, and
  //    a frozen entry that stops reproducing FAILS — so the list cannot decay
  //    into a blanket suppression.
  //
  //    A frozen entry is only honoured when the catalog that produced it could
  //    actually see the table. On a point-in-time baseline, a table that is
  //    absent proves nothing, so `stale` is reported only for tables present in
  //    this catalog.
  const knownMap = new Map((known || []).map((k) => [k.key, k]));
  const open = [];
  const knownSeen = [];
  for (const f of findings) {
    const k = f.severity === 'error' ? knownMap.get(`${f.table}.${f.column}`) : null;
    if (k) knownSeen.push({ ...f, owner: k.owner, classification: k.classification });
    else open.push(f);
  }
  const seenKeys = new Set(knownSeen.map((f) => `${f.table}.${f.column}`));
  const staleKnown = [...knownMap.keys()].filter(
    (key) => !seenKeys.has(key) && catalog.tables.has(key.split('.')[0]),
  );

  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of open) counts[f.severity]++;
  counts.error += staleKnown.length;
  return {
    findings: open,
    known_open: knownSeen,
    stale_known: staleKnown,
    counts,
    declared: decl.size,
    declared_covered: seenDeclared.size,
    source: catalog.source,
    coverage: catalog.coverage,
  };
}

// ───────────────────────── CLI ─────────────────────────

function loadRegistry() {
  if (!fs.existsSync(REGISTRY)) return { columns: [] };
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

/** The `catalog_known` section of the shared acknowledgement file. */
function loadKnown() {
  if (!fs.existsSync(KNOWN)) return [];
  return JSON.parse(fs.readFileSync(KNOWN, 'utf8')).catalog_known || [];
}

/** The `not_modelled_trigger_armed` section — the class this detector cannot judge. */
function loadNotModelled() {
  if (!fs.existsSync(KNOWN)) return null;
  return JSON.parse(fs.readFileSync(KNOWN, 'utf8')).not_modelled_trigger_armed || null;
}

/**
 * Print, on EVERY run, what this detector could not judge — by name, not as a
 * disclaimer. The single most valuable property of a gate is that its silence
 * means something; silence over a class it cannot model is a lie.
 *
 * Two limits:
 *   1. the input's own horizon (a point-in-time dump cannot see later tables);
 *   2. trigger-armed referential actions, which no nullability-or-CHECK
 *      analysis can reach. A SET NULL IS an UPDATE and a CASCADE IS a DELETE,
 *      so a BEFORE UPDATE/DELETE guard that can RAISE or RETURN NULL refuses
 *      the referential action and aborts the parent delete. Verdicts are Agent
 *      F's, consumed as evidence; see set-null-known-defects.json.
 */
function reportCoverageLimits(result, out = process.stdout) {
  if (result.coverage.boundary) {
    out.write(
      `[actor-fk] COVERAGE LIMIT 1/2 — INPUT HORIZON: this run read a point-in-time dump at ledger ` +
      `position ${result.coverage.boundary}. Tables created by later migrations are NOT covered. ` +
      'The --db path (real-schema CI, after replay) is what covers them.\n',
    );
  } else {
    out.write('[actor-fk] COVERAGE LIMIT 1/2 — INPUT HORIZON: none; this run read a live catalog.\n');
  }
  const nm = result.not_modelled;
  if (!nm) {
    out.write(
      '[actor-fk] COVERAGE LIMIT 2/2 — TRIGGER-ARMED ACTIONS: this detector models declared ' +
      'nullability and CHECK constraints only. A BEFORE UPDATE/DELETE guard that can RAISE or ' +
      'RETURN NULL also refuses a referential action, and such a foreign key is NOT judged here. ' +
      'No acknowledgement list is present, so the size of that blind spot is unknown.\n',
    );
    return;
  }
  const unseen = nm.keys.filter((k) => !(nm.also_found_by_this_detector || []).includes(k.key));
  out.write(
    `[actor-fk] COVERAGE LIMIT 2/2 — TRIGGER-ARMED ACTIONS: ${nm.actually_armed} foreign key(s) are armed ` +
    'by a BEFORE UPDATE/DELETE guard that can refuse the referential action itself (a SET NULL IS an ' +
    'UPDATE; a CASCADE IS a DELETE). This detector models nullability and CHECK constraints only, so ' +
    `${unseen.length} of them are reported above as CLEAN and are NOT. Source: ${nm.source}\n` +
    `           Deciding predicate: ${nm.deciding_predicate}.\n` +
    `           Gating on guard PRESENCE instead would return ${nm.candidate_surface_if_gated_on_presence}, ` +
    `of which only ${nm.actually_armed} are armed — which is why no trigger rule is implemented here.\n`,
  );
  for (const k of unseen) {
    out.write(`           NOT JUDGED  public.${k.key}  ${k.action}  ${k.verdict}  [${k.guard}]\n`);
  }
}

async function main(argv) {
  const dbIdx = argv.indexOf('--db');
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict'); // also fail on `info`
  const registry = loadRegistry();

  let catalog;
  if (dbIdx >= 0) {
    const url = argv[dbIdx + 1] || process.env.ACTOR_FK_DB_URL;
    if (!url) { process.stderr.write('--db requires a connection URL\n'); return 2; }
    catalog = await readPgCatalog(url);
  } else {
    if (!fs.existsSync(BASELINE_SQL)) {
      process.stderr.write(`missing ${BASELINE_SQL}\n`);
      return 2;
    }
    const meta = fs.existsSync(BASELINE_META) ? JSON.parse(fs.readFileSync(BASELINE_META, 'utf8')) : {};
    catalog = parseBaselineCatalog(fs.readFileSync(BASELINE_SQL, 'utf8'), {
      source: 'supabase/_schema/baseline.sql',
      boundary: meta.ledgerMax || null,
    });
  }

  const result = detect(catalog, registry, loadKnown());
  result.not_modelled = loadNotModelled();
  const failing = result.counts.error + (strict ? result.counts.info : 0);

  if (asJson) {
    console.log(JSON.stringify({ event: 'actor_fk_compatibility.check', ...result }, null, 2));
  } else {
    console.log(JSON.stringify({
      event: 'actor_fk_compatibility.check',
      source: result.source,
      tables: result.coverage.tables,
      foreign_keys: result.coverage.foreignKeys,
      catalog_boundary: result.coverage.boundary,
      registry_columns: result.declared,
      registry_columns_with_fk_present: result.declared_covered,
      known_open: result.known_open.length,
      stale_known: result.stale_known.length,
      errors: result.counts.error,
      info: result.counts.info,
    }));
    for (const key of result.stale_known) {
      process.stderr.write(`\n[actor-fk] STALE ACKNOWLEDGEMENT: '${key}' is frozen in ` +
        'scripts/migrations/set-null-known-defects.json (catalog_known) but no longer reproduces against ' +
        `${result.source}. Remove the entry so the list keeps matching reality.\n`);
    }
    if (result.known_open.length) {
      process.stdout.write(`\n[actor-fk] ${result.known_open.length} KNOWN OPEN contradiction(s) — acknowledged, not fixed:\n\n`);
      for (const f of result.known_open) {
        process.stdout.write(`  ${f.rule}  public.${f.table}.${f.column}${f.constraint ? ` [${f.constraint}]` : ''}\n`);
        process.stdout.write(`    ${f.classification} — owner: ${f.owner}\n`);
      }
      process.stdout.write('\n');
    }
    for (const sev of ['error', 'info']) {
      const group = result.findings.filter((f) => f.severity === sev);
      if (!group.length) continue;
      const out = sev === 'error' ? process.stderr : process.stdout;
      out.write(`\n[actor-fk] ${group.length} ${sev.toUpperCase()} finding(s):\n\n`);
      for (const f of group) {
        out.write(`  ${f.rule}  public.${f.table}.${f.column}${f.constraint ? ` [${f.constraint}]` : ''}\n`);
        out.write(`    ${f.detail}\n\n`);
      }
    }
    reportCoverageLimits(result);
    if (!failing) {
      console.log(
        `[actor-fk] OK — no NEW FK/NOT NULL/CHECK contradiction in ${result.coverage.foreignKeys} foreign keys` +
        (result.known_open.length
          ? `; ${result.known_open.length} known contradiction(s) remain OPEN and are listed above.`
          : '.'),
      );
    }
  }
  return failing ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`[actor-fk] FAILED: ${e.message}\n`); process.exitCode = 2; });
}

module.exports = {
  loadKnown,
  loadNotModelled,
  reportCoverageLimits,
  toArray,
  parseBaselineCatalog,
  readPgCatalog,
  detect,
  columnsRequiredNonNullByCheck,
  looksLikeActorColumn,
  assertLocalTarget,
  splitTopLevel,
  main,
};
