#!/usr/bin/env node
/**
 * generate-schema-manifest — writes a machine-readable catalog of the
 * auth-spine schema surface to `generated/schema-column-manifest.json`.
 *
 * Consumers (verified 2026-10-31)
 * ─────────
 * - `backend/security/startup/bootFingerprint.ts` reads `manifest_hash` at
 *   runtime; it is reported as `schema_manifest_hash` by
 *   `/api/health/version`, `/api/health/readiness` and the super-admin
 *   operations center, and it is an input to the boot `fingerprint` digest.
 * - Nothing else reads the file. `scripts/check-schema-drift.js` and
 *   `pages/api/health/schema.ts` are self-contained.
 *
 * The manifest is intentionally derived (not hand-edited). Re-run after
 * every migration change that touches a watched table:
 *
 *   node scripts/generate-schema-manifest.js
 *
 * NOTHING runs this automatically — not prebuild, not the worker image, not
 * CI. (An earlier header claimed "CI invokes it as part of the prebuild
 * step"; that was never true, which is how the committed file went stale.)
 * The committed file IS what ships, so CI instead verifies it is current:
 *
 *   node scripts/generate-schema-manifest.js --check
 *
 * `--check` never writes. It recomputes the migration-derived part of the
 * manifest (the `manifest_hash` input: table, column, source_migration, plus
 * lifecycle_critical) and exits 1 if the committed file disagrees, 2 if the
 * file is missing or unreadable, 0 if current. `first_consumer` is a code
 * line pointer that moves with unrelated edits; it is not part of the hash
 * and is not gated (pass `--consumers` to print, never fail on, its drift).
 * `--manifest <path>` checks a different file (used by the contract test).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const OUTPUT_DIR = path.join(REPO_ROOT, 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'schema-column-manifest.json');
const PROJECTION_FILE = path.join(REPO_ROOT, 'backend', 'services', 'userColumnProjection.ts');
const CODE_DIRS = ['backend', 'pages', 'modules', 'lib', 'components', 'shared'];

/**
 * Tables included in the manifest. Keep this aligned with
 * `WATCHED_TABLES` in `check-schema-drift.js`. Adding a new table
 * requires both lists to be updated.
 */
const WATCHED_TABLES = new Set(['users', 'companies']);

/**
 * Columns whose creation/migration history is load-bearing for the
 * auth spine. The manifest tags these as `lifecycle_critical: true`
 * so downstream consumers (readiness endpoint, dev panel) can render
 * the right urgency.
 */
const LIFECYCLE_CRITICAL_COLUMNS = new Set([
  'status',
  'session_revoked_after',
  'activated_at',
  'deleted_at',
]);

// ── Reads (duplicated from drift checker, intentionally) ────────────────────

function readMigrationManifest() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const manifest = new Map();
  function ensure(table) {
    if (!manifest.has(table)) manifest.set(table, new Map());
    return manifest.get(table);
  }
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    const addColumnRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)[\s\S]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
    let m;
    while ((m = addColumnRegex.exec(sql)) !== null) {
      const table = m[1];
      if (!WATCHED_TABLES.has(table)) continue;
      if (!ensure(table).has(m[2])) ensure(table).set(m[2], file);
    }

    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi;
    while ((m = createTableRegex.exec(sql)) !== null) {
      const table = m[1];
      if (!WATCHED_TABLES.has(table)) { createTableRegex.lastIndex; continue; }
      const start = createTableRegex.lastIndex;
      let depth = 1;
      let i = start;
      while (i < sql.length && depth > 0) {
        const ch = sql[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      const body = sql.slice(start, i - 1);
      const parts = [];
      let buf = '';
      let bdepth = 0;
      for (const ch of body) {
        if (ch === '(') bdepth++;
        else if (ch === ')') bdepth--;
        if (ch === ',' && bdepth === 0) { parts.push(buf); buf = ''; continue; }
        buf += ch;
      }
      if (buf.trim()) parts.push(buf);
      for (const part of parts) {
        const trimmed = part.trim();
        if (/^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i.test(trimmed)) continue;
        const colMatch = trimmed.match(/^"?(\w+)"?/);
        if (colMatch && !ensure(table).has(colMatch[1])) ensure(table).set(colMatch[1], file);
      }
    }
  }
  return manifest;
}

// ── First-consumer detection (AST) ─────────────────────────────────────────

function walk(dir, results) {
  if (!fs.existsSync(dir)) return;
  // Sorted so "first consumer" does not depend on the filesystem's readdir
  // order (NTFS is name-ordered, ext4 is not).
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (/\.(ts|tsx)$/.test(entry.name)) results.push(full);
  }
}

function loadProjectionConstants() {
  const constants = new Map();
  if (!fs.existsSync(PROJECTION_FILE)) return constants;
  const src = fs.readFileSync(PROJECTION_FILE, 'utf8');
  const sf = ts.createSourceFile(PROJECTION_FILE, src, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!stmt.modifiers || !stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      let init = decl.initializer;
      if (init && ts.isAsExpression(init)) init = init.expression;
      if (init && ts.isStringLiteralLike(init)) {
        constants.set(decl.name.text, init.text);
      }
    }
  }
  return constants;
}

function findFirstConsumers(projectionConstants) {
  const consumers = new Map(); // `${table}.${column}` -> { file, line }
  const files = [];
  for (const dir of CODE_DIRS) walk(path.join(REPO_ROOT, dir), files);

  for (const file of files) {
    if (file === PROJECTION_FILE) continue;
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

    function tableFor(selectCall) {
      let cursor = selectCall.expression && selectCall.expression.expression;
      while (cursor) {
        if (ts.isCallExpression(cursor)) {
          const callee = cursor.expression;
          if (callee && ts.isPropertyAccessExpression(callee) && callee.name.text === 'from') {
            const first = cursor.arguments[0];
            if (first && ts.isStringLiteralLike(first)) return first.text;
            return null;
          }
          cursor = cursor.expression && cursor.expression.expression;
          continue;
        }
        if (ts.isPropertyAccessExpression(cursor)) { cursor = cursor.expression; continue; }
        break;
      }
      return null;
    }

    function resolveArg(arg) {
      if (!arg) return null;
      if (ts.isStringLiteralLike(arg)) return arg.text;
      if (ts.isIdentifier(arg)) {
        const name = arg.text;
        for (const stmt of sf.statements) {
          if (!ts.isVariableStatement(stmt)) continue;
          for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
            let init = decl.initializer;
            if (init && ts.isAsExpression(init)) init = init.expression;
            if (init && ts.isStringLiteralLike(init)) return init.text;
          }
        }
        if (projectionConstants.has(name)) return projectionConstants.get(name);
      }
      return null;
    }

    function visit(node) {
      if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'select') {
        const table = tableFor(node);
        if (table && WATCHED_TABLES.has(table)) {
          const cols = resolveArg(node.arguments[0]);
          if (cols) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            for (const raw of cols.split(',')) {
              const col = raw.trim().split(/\s+/)[0];
              const key = `${table}.${col}`;
              if (!consumers.has(key)) {
                // POSIX separators so the committed file is identical whether
                // it was generated on Windows or Linux.
                consumers.set(key, { file: path.relative(REPO_ROOT, file).split(path.sep).join('/'), line: line + 1 });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  return consumers;
}

// ── Output ──────────────────────────────────────────────────────────────────

function hashManifest(manifest) {
  // Stable, deterministic hash so deployment fingerprints can use it.
  // We intentionally use `crypto.createHash` rather than a JS-shimmed
  // alternative — this is a build-time script with full Node access.
  const crypto = require('crypto');
  const entries = [];
  for (const [table, cols] of [...manifest.entries()].sort()) {
    for (const [col, src] of [...cols.entries()].sort()) {
      entries.push(`${table}.${col}=${src}`);
    }
  }
  return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}

// ── --check (read-only CI gate) ─────────────────────────────────────────────

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/** The hash-relevant identity of one column row. */
function columnKey(c) {
  return `${c.table}.${c.column}=${c.source_migration}|critical=${c.lifecycle_critical === true}`;
}

function runCheck() {
  const target = argValue('--manifest') ? path.resolve(argValue('--manifest')) : OUTPUT_FILE;
  const rel = path.relative(REPO_ROOT, target).split(path.sep).join('/');
  let committed;
  try {
    committed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    console.error(`schema-manifest --check: cannot read ${rel}: ${e && e.message ? e.message : e}`);
    return 2;
  }

  const manifest = readMigrationManifest();
  const expectedHash = hashManifest(manifest);
  const expected = [];
  for (const [table, cols] of [...manifest.entries()].sort()) {
    for (const [column, src] of [...cols.entries()].sort()) {
      expected.push({ table, column, source_migration: src, lifecycle_critical: LIFECYCLE_CRITICAL_COLUMNS.has(column) });
    }
  }
  const committedCols = Array.isArray(committed.columns) ? committed.columns : [];
  const want = new Set(expected.map(columnKey));
  const have = new Set(committedCols.map(columnKey));
  const missing = [...want].filter((k) => !have.has(k)).sort();
  const extra = [...have].filter((k) => !want.has(k)).sort();
  const watchedOk = JSON.stringify(committed.watched_tables) === JSON.stringify([...WATCHED_TABLES].sort());

  // The committed hash must match both the migrations AND the committed rows,
  // so a hand-edited hash or hand-edited rows cannot pass.
  const committedRowsHash = (() => {
    const m = new Map();
    for (const c of committedCols) {
      if (!m.has(c.table)) m.set(c.table, new Map());
      m.get(c.table).set(c.column, c.source_migration);
    }
    return hashManifest(m);
  })();

  const problems = [];
  if (committed.manifest_hash !== expectedHash) {
    problems.push(`manifest_hash ${String(committed.manifest_hash).slice(0, 16)}… != regenerated ${expectedHash.slice(0, 16)}…`);
  }
  if (committedRowsHash !== committed.manifest_hash) {
    problems.push('manifest_hash does not match the committed columns (hand-edited?)');
  }
  if (!watchedOk) problems.push(`watched_tables ${JSON.stringify(committed.watched_tables)} != ${JSON.stringify([...WATCHED_TABLES].sort())}`);
  if (committedCols.length !== expected.length) problems.push(`${committedCols.length} committed columns != ${expected.length} regenerated`);
  for (const k of missing) problems.push(`missing/changed: ${k}`);
  for (const k of extra) problems.push(`stale/extra:     ${k}`);

  if (process.argv.includes('--consumers')) {
    const consumers = findFirstConsumers(loadProjectionConstants());
    let drift = 0;
    for (const c of committedCols) {
      const now = consumers.get(`${c.table}.${c.column}`) ?? null;
      if (JSON.stringify(now) !== JSON.stringify(c.first_consumer ?? null)) drift++;
    }
    console.log(`schema-manifest --check: first_consumer drift on ${drift} row(s) (advisory, never fails)`);
  }

  if (problems.length > 0) {
    console.error(`schema-manifest --check: FAIL — ${rel} is stale (${problems.length} problem(s)):`);
    for (const p of problems.slice(0, 50)) console.error(`  - ${p}`);
    console.error('Regenerate with `node scripts/generate-schema-manifest.js` and commit the result.');
    console.error('Note: the new manifest_hash is reported by /api/health/version after the next deploy.');
    return 1;
  }
  console.log(`schema-manifest --check: OK — ${rel} is current (${expected.length} columns, manifest_hash ${expectedHash.slice(0, 16)}…)`);
  return 0;
}

function main() {
  if (process.argv.includes('--check')) {
    process.exit(runCheck());
  }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = readMigrationManifest();
  const projectionConstants = loadProjectionConstants();
  const consumers = findFirstConsumers(projectionConstants);

  const columns = [];
  for (const [table, cols] of [...manifest.entries()].sort()) {
    for (const [column, src] of [...cols.entries()].sort()) {
      columns.push({
        table,
        column,
        source_migration:     src,
        first_consumer:       consumers.get(`${table}.${column}`) ?? null,
        lifecycle_critical:   LIFECYCLE_CRITICAL_COLUMNS.has(column),
      });
    }
  }

  const output = {
    schema_version: 1,
    generated_at:   new Date().toISOString(),
    manifest_hash:  hashManifest(manifest),
    watched_tables: [...WATCHED_TABLES].sort(),
    columns,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`generate-schema-manifest: wrote ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  console.log(`  ${columns.length} columns across ${manifest.size} tables`);
  console.log(`  manifest_hash = ${output.manifest_hash.slice(0, 16)}…`);
}

main();
