/**
 * PI-LDB-4 — real-schema acceptance of `lead_intelligence.display`.
 *
 * ─── WHAT THIS FILE IS FOR ────────────────────────────────────────────────────
 * Migration `20270201000003_pi_ldb_lead_intelligence_display.sql` ends with its
 * own `DO $verify$` block, and that block runs inside the migration's own
 * transaction. It therefore proves one thing only: that the statements the
 * migration just issued took effect in the session that issued them. It cannot
 * prove that the column still exists later, that the CHECK it declared actually
 * REFUSES anything, that the index it created is usable, or that the repository
 * which reads the column gets the stored value back.
 *
 * Every assertion below is made against the live catalog or by executing a
 * statement and observing the SQLSTATE it raised. A test that only inserted
 * valid rows would pass against a table with no constraint at all, so each
 * refusal here names the code it expects.
 *
 * ─── THE TRANSPORT SEAM, STATED PLAINLY ───────────────────────────────────────
 * The production read/write path is `ownedDbTable` -> `backend/db/supabaseClient`
 * -> PostgREST over HTTP. There is no PostgREST in this harness. The application
 * halves of this file therefore mock ONE module — `backend/db/supabaseClient` —
 * with a builder that speaks the same fluent surface and executes the SAME SQL
 * against the real database through `pg`.
 *
 * What that substitutes is the TRANSPORT. The services under test are the real
 * ones, unmodified: `upsertCanonicalLeadWithOutcome` / `listCanonicalLeads` /
 * `rowToView` from `leadIntelligenceRepository`, `searchLeads` with its real
 * `defaultLeadSourceReaders`, and the real `classifyWriteOutcome`. What is NOT
 * covered is PostgREST's own behaviour: its schema cache (`PGRST204`/`PGRST205`
 * rather than `42703`/`42P01`), its JSON body coercion, and its HTTP error
 * shapes. The `postgrestNullMapping` test below pins the one piece of that
 * coercion this column depends on, using the very function PostgREST builds
 * its INSERT from.
 */

import {
  ORG_A,
  attempt,
  constraintDef,
  db,
  effect,
  inRollback,
  seedTenants,
} from './setup';

/* ── the pg-backed PostgREST transport ──────────────────────────────────────
 *
 * Each statement runs inside its own savepoint. A refused statement aborts the
 * enclosing transaction in Postgres, and the enclosing transaction is
 * `inRollback`'s — so without the savepoint the FIRST rejection the repository
 * provokes would poison every later assertion in the same test.
 *
 * The resolved shape mirrors @supabase/postgrest-js: `{ data, error, status }`,
 * never a rejection, with the SQLSTATE in `error.code`. That is what makes the
 * real `classifyWriteOutcome` reachable from here.
 */
jest.mock('../../db/supabaseClient', () => {
  const { db: client } = require('./setup');

  const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';

  class Builder {
    // Declared because `backend/tests` is type-checked by its own project
    // (`tsconfig.backend-tests.json`), which `npm run typecheck` does NOT
    // cover, and ts-jest is transpile-only — so a green run proves nothing
    // about types here. Without these, every `this.x` is a TS2339.
    table: string;
    mode: 'select' | 'insert' | 'upsert';
    returning: string;
    wheres: string[];
    params: unknown[];
    orders: string[];
    limitN: number | null;
    oneRow: boolean;
    payload: Record<string, unknown> | null;
    conflict: string[];

    constructor(table) {
      this.table = table;
      this.mode = 'select';
      this.returning = '*';
      this.wheres = [];
      this.params = [];
      this.orders = [];
      this.limitN = null;
      this.oneRow = false;
      this.payload = null;
      this.conflict = [];
    }

    p(v) { this.params.push(v); return '$' + this.params.length; }

    select(cols) {
      this.returning = cols && cols !== '*'
        ? cols.split(',').map((c) => ident(c.trim())).join(', ')
        : '*';
      return this;
    }
    eq(col, val) { this.wheres.push(ident(col) + ' = ' + this.p(val)); return this; }
    neq(col, val) { this.wheres.push(ident(col) + ' <> ' + this.p(val)); return this; }
    in(col, vals) { this.wheres.push(ident(col) + ' = ANY(' + this.p(vals) + ')'); return this; }
    is(col, val) {
      this.wheres.push(val === null ? ident(col) + ' IS NULL' : ident(col) + ' IS ' + (val ? 'TRUE' : 'FALSE'));
      return this;
    }
    order(col, opts) {
      this.orders.push(ident(col) + (opts && opts.ascending === false ? ' DESC' : ' ASC'));
      return this;
    }
    limit(n) { this.limitN = n; return this; }
    maybeSingle() { this.oneRow = true; return this; }
    single() { this.oneRow = true; return this; }
    insert(row) { this.mode = 'insert'; this.payload = row; return this; }
    upsert(row, opts) {
      this.mode = 'upsert';
      this.payload = row;
      this.conflict = String((opts && opts.onConflict) || '').split(',').map((c) => c.trim()).filter(Boolean);
      return this;
    }

    build() {
      if (this.mode === 'select') {
        let sql = 'SELECT ' + this.returning + ' FROM public.' + ident(this.table);
        if (this.wheres.length) sql += ' WHERE ' + this.wheres.join(' AND ');
        if (this.orders.length) sql += ' ORDER BY ' + this.orders.join(', ');
        if (this.limitN !== null) sql += ' LIMIT ' + Number(this.limitN);
        return sql;
      }
      const row = this.payload || {};
      const cols = Object.keys(row);
      const vals = cols.map((c) => this.p(row[c]));
      let sql = 'INSERT INTO public.' + ident(this.table)
        + ' (' + cols.map(ident).join(', ') + ') VALUES (' + vals.join(', ') + ')';
      if (this.mode === 'upsert' && this.conflict.length) {
        const upd = cols.filter((c) => this.conflict.indexOf(c) === -1);
        sql += ' ON CONFLICT (' + this.conflict.map(ident).join(', ') + ') DO UPDATE SET '
          + (upd.length
            ? upd.map((c) => ident(c) + ' = EXCLUDED.' + ident(c)).join(', ')
            : ident(cols[0]) + ' = EXCLUDED.' + ident(cols[0]));
      }
      sql += ' RETURNING ' + this.returning;
      return sql;
    }

    async exec() {
      const sql = this.build();
      await client.query('SAVEPOINT shim');
      try {
        const res = await client.query(sql, this.params);
        await client.query('RELEASE SAVEPOINT shim');
        const rows = res.rows;
        return { data: this.oneRow ? (rows.length ? rows[0] : null) : rows, error: null, status: 200 };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT shim');
        // PostgREST relays the SQLSTATE in `code` and composes `details` from
        // the server's DETAIL. Both are what the classifier reads.
        return {
          data: null,
          error: {
            code: err.code || '',
            message: err.message || String(err),
            details: err.detail || null,
            hint: err.hint || null,
          },
          status: 400,
        };
      }
    }

    then(onOk, onErr) { return this.exec().then(onOk, onErr); }
  }

  return {
    supabase: {
      from: (table) => new Builder(table),
      rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'no rpc in this harness' }, status: 404 }),
    },
    getDbConnectionDiagnostics: () => ({ mode: 'direct', poolerConfigured: false }),
  };
});

// Imported AFTER the mock factory above (jest hoists `jest.mock`, so these see
// the pg-backed seam). These are the real services; nothing about them is faked.
import {
  upsertCanonicalLeadWithOutcome,
  listCanonicalLeads,
  getCanonicalLead,
} from '../../services/leadIntelligence/leadIntelligenceRepository';
import { searchLeads, defaultLeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import { classifyWriteOutcome } from '../../../lib/leadIntelligence/projectionResult';
import type { CanonicalLead } from '../../../lib/leadIntelligence/types';

const TABLE = 'public.lead_intelligence';
const COLUMN = 'display';
const CHECK = 'lead_intelligence_display_is_object';
const INDEX = 'idx_lead_intelligence_display_name';

/* Synthetic canonical-prospect ids. REAL UUIDs on purpose: `source_id` is text,
 * but the provenance reader the read service calls queries
 * `prospect_source_contributions` by these values against a uuid column, so a
 * `prospect-3`-style label makes that read fail with 22P02 and the search test
 * then passes with provenance DEGRADED. A uuid keeps the read service on its
 * normal path. */
const P1 = '00000000-0000-4000-8000-0000000000c1';
const P2 = '00000000-0000-4000-8000-0000000000c2';
const P3 = '00000000-0000-4000-8000-0000000000c3';
const P4 = '00000000-0000-4000-8000-0000000000c4';
const PM = '00000000-0000-4000-8000-0000000000cf';

/** A real `CanonicalLead` carrying a display label. */
function leadWith(display: any, ref: string): CanonicalLead {
  return {
    organizationId: ORG_A,
    source: 'import',
    unifiedPersonId: null,
    ingestedAt: '2026-11-04T00:00:00.000Z',
    occurredAt: '2026-11-03T00:00:00.000Z',
    status: null,
    identity: { email: 'ada@example.test', phone: null, unifiedPersonId: null },
    attribution: {
      originalSource: 'csv',
      originalChannel: 'import',
      campaign: null,
      content: null,
      session: null,
      journey: null,
      referrer: null,
      utm: { source: null, medium: null, campaign: null, content: null, term: null },
      identity: { email: 'ada@example.test' },
      sourceMetadata: { raw_full_name: 'Ada Lovelace' },
    },
    display,
    sourceRef: { table: 'canonical_leads', id: ref },
  } as unknown as CanonicalLead;
}

describe('PI-LDB-4 — lead_intelligence.display: catalog', () => {
  it('the column exists, is jsonb, and is nullable with no default', async () => {
    const { rows } = await db.query(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS pg_type, a.attnotnull,
              pg_get_expr(d.adbin, d.adrelid) AS col_default
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1::regclass AND a.attname = $2
          AND a.attnum > 0 AND NOT a.attisdropped`,
      [TABLE, COLUMN],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pg_type).toBe('jsonb');
    // Nullability is what the MIGRATION says it must be, not an assumption:
    // its own postcondition raises unless `is_nullable = 'YES'`, with the
    // reason stated there — a NOT NULL would break every pre-existing writer.
    expect(rows[0].attnotnull).toBe(false);
    expect(rows[0].col_default).toBeNull();
  });

  it('information_schema agrees (jsonb / YES), so the migration postcondition would pass today', async () => {
    const { rows } = await db.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'lead_intelligence' AND column_name = $1`,
      [COLUMN],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('jsonb');
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].column_default).toBeNull();
  });

  it('the object-shape CHECK exists, with exactly the declared predicate, validated', async () => {
    const def = await constraintDef(CHECK);
    expect(def).not.toBeNull();
    expect(def).toContain('display IS NULL');
    expect(def).toContain("jsonb_typeof(display) = 'object'");
    const { rows } = await db.query(
      'SELECT contype, convalidated FROM pg_constraint WHERE conname = $1', [CHECK],
    );
    expect(rows[0].contype).toBe('c');
    // An unvalidated CHECK would admit pre-existing bad rows and is not the
    // same guarantee at all.
    expect(rows[0].convalidated).toBe(true);
  });

  it('the partial expression index on the extracted name exists, on this relation', async () => {
    const { rows } = await db.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1", [INDEX],
    );
    expect(rows).toHaveLength(1);
    const def: string = rows[0].indexdef;
    expect(def).toContain('USING btree');
    expect(def).toContain("display ->> 'name'");
    expect(def).toContain("WHERE (display ? 'name'");
    const { rows: who } = await db.query(
      `SELECT c.relname FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_class c ON c.oid = i.indrelid
        WHERE ic.relname = $1`, [INDEX],
    );
    expect(who[0].relname).toBe('lead_intelligence');
  });

  it('the migration left the store identity key alone', async () => {
    const def = await constraintDef('lead_intelligence_dedupe_unique');
    expect(def).toBe('UNIQUE (company_id, dedupe_key)');
  });

  it('the column carries the documented comment, so the provenance rationale is not folklore', async () => {
    const { rows } = await db.query(
      `SELECT col_description($1::regclass, a.attnum) AS c
         FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attname = $2`,
      [TABLE, COLUMN],
    );
    expect(String(rows[0].c)).toContain('{ name, title, contentText }');
  });
});

describe('PI-LDB-4 — executed behaviour', () => {
  it('accepts an object and hands back every key', async () => {
    await inRollback(async () => {
      await seedTenants();
      const payload = { name: 'Ada Lovelace', title: 'Head of Analysis', contentText: null };
      const code = await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-ok', 'import', $2::jsonb)`,
        [ORG_A, JSON.stringify(payload)],
      );
      expect(code).toBe('ok');
      const { rows } = await db.query(
        `SELECT jsonb_typeof(display) t, display ->> 'name' n, display ->> 'title' ti,
                (display ? 'contentText') has_ct, display -> 'contentText' ct
           FROM ${TABLE} WHERE company_id = $1 AND dedupe_key = 'dk-ok'`, [ORG_A],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].t).toBe('object');
      expect(rows[0].n).toBe('Ada Lovelace');
      expect(rows[0].ti).toBe('Head of Analysis');
      // A JSON null INSIDE the object survives the round trip: "we looked and
      // there is none" is a different claim from "the key is absent".
      expect(rows[0].has_ct).toBe(true);
      expect(rows[0].ct).toBeNull();
    });
  });

  it('accepts an empty object (an object is an object)', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-empty', 'import', '{}'::jsonb)`, [ORG_A],
      )).toBe('ok');
    });
  });

  it('accepts SQL NULL, and accepts the column being omitted entirely', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-null', 'import', NULL)`, [ORG_A],
      )).toBe('ok');
      expect(await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source)
         VALUES ($1, 'dk-omitted', 'import')`, [ORG_A],
      )).toBe('ok');
      const { rows } = await db.query(
        `SELECT dedupe_key, display IS NULL AS is_null FROM ${TABLE}
          WHERE company_id = $1 AND dedupe_key IN ('dk-null','dk-omitted')
          ORDER BY dedupe_key`, [ORG_A],
      );
      expect(rows.map((r: any) => [r.dedupe_key, r.is_null]))
        .toEqual([['dk-null', true], ['dk-omitted', true]]);
    });
  });

  it.each([
    ['a bare string', '"Ada Lovelace"'],
    ['an array', '["Ada Lovelace"]'],
    ['a number', '42'],
    ['a boolean', 'true'],
    ['a JSON null literal, which is NOT the same thing as SQL NULL', 'null'],
  ])('REFUSES %s with 23514', async (_label, json) => {
    await inRollback(async () => {
      await seedTenants();
      const code = await attempt(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-bad', 'import', $2::jsonb)`,
        [ORG_A, json],
      );
      expect(code).toBe('23514');
    });
  });

  it('names the display constraint in the refusal, not some other CHECK on the table', async () => {
    await inRollback(async () => {
      await seedTenants();
      let captured: any = null;
      await db.query('SAVEPOINT probe');
      try {
        await db.query(
          `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
           VALUES ($1, 'dk-bad2', 'import', '[]'::jsonb)`, [ORG_A],
        );
      } catch (e) { captured = e; }
      await db.query('ROLLBACK TO SAVEPOINT probe');
      expect(captured).not.toBeNull();
      expect(captured.code).toBe('23514');
      expect(captured.constraint).toBe(CHECK);
    });
  });

  it('REFUSES an UPDATE that would turn a good object into a scalar', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await effect(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-upd', 'import', '{"name":"Ada"}'::jsonb)`, [ORG_A],
      )).toBe('ok');
      expect(await attempt(
        `UPDATE ${TABLE} SET display = '"Ada"'::jsonb
          WHERE company_id = $1 AND dedupe_key = 'dk-upd'`, [ORG_A],
      )).toBe('23514');
      const { rows } = await db.query(
        `SELECT jsonb_typeof(display) t FROM ${TABLE}
          WHERE company_id = $1 AND dedupe_key = 'dk-upd'`, [ORG_A],
      );
      expect(rows[0].t).toBe('object');
    });
  });

  it('the name index is usable by the planner for the list view predicate', async () => {
    await inRollback(async () => {
      await db.query('SET LOCAL enable_seqscan = off');
      const { rows } = await db.query(
        `EXPLAIN (COSTS OFF) SELECT id FROM ${TABLE}
          WHERE display ? 'name' AND display ->> 'name' = 'Ada Lovelace'`,
      );
      const plan = rows.map((r: any) => r['QUERY PLAN']).join('\n');
      expect(plan).toContain(INDEX);
    });
  });

  it('postgrestNullMapping: a JSON null body value becomes SQL NULL, not a jsonb null', async () => {
    // PostgREST builds its INSERT from `json_populate_recordset` over the
    // request body. The repository writes `display: lead.display ?? null`, and
    // the CHECK above REFUSES a jsonb `null` — so which of the two a JSON null
    // becomes is the difference between a working write and a 23514 on every
    // display-less lead. Pinned against the actual function, not reasoned about.
    const { rows } = await db.query(
      `SELECT display IS NULL AS sql_null, jsonb_typeof(display) AS t
         FROM json_populate_recordset(null::public.lead_intelligence, '[{"display": null}]'::json)`,
    );
    expect(rows[0].sql_null).toBe(true);
    expect(rows[0].t).toBeNull();
    const { rows: obj } = await db.query(
      `SELECT jsonb_typeof(display) AS t, display ->> 'name' AS n
         FROM json_populate_recordset(null::public.lead_intelligence, '[{"display": {"name": "Ada"}}]'::json)`,
    );
    expect(obj[0].t).toBe('object');
    expect(obj[0].n).toBe('Ada');
  });
});

describe('PI-LDB-4 — the real repository and the real read service', () => {
  it('upsertCanonicalLeadWithOutcome persists display, and rowToView returns it', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = leadWith({ name: 'Ada Lovelace', title: 'Head of Analysis', contentText: null }, P1);
      const outcome = await upsertCanonicalLeadWithOutcome(lead);
      expect(outcome.status).toBe('persisted');
      expect(outcome.reason).toBeNull();
      expect(outcome.leadId).toBeTruthy();

      // What the DATABASE says landed.
      const { rows } = await db.query(
        `SELECT display ->> 'name' n, display ->> 'title' ti, jsonb_typeof(display) t
           FROM ${TABLE} WHERE id = $1`, [outcome.leadId],
      );
      expect(rows[0]).toEqual({ n: 'Ada Lovelace', ti: 'Head of Analysis', t: 'object' });

      // The REAL read path: getCanonicalLead -> rowToView.
      const view = await getCanonicalLead(ORG_A, outcome.leadId as string);
      expect(view).not.toBeNull();
      expect((view as any).display).toEqual({ name: 'Ada Lovelace', title: 'Head of Analysis', contentText: null });

      // And the bulk read the read service's durable reader uses.
      const list = await listCanonicalLeads({ companyId: ORG_A });
      const mine = list.find((v: any) => v.sourceRef && v.sourceRef.id === P1);
      expect(mine).toBeTruthy();
      expect((mine as any).display.name).toBe('Ada Lovelace');
    });
  });

  it('a NULL display reads back as undefined, not as an empty object', async () => {
    await inRollback(async () => {
      await seedTenants();
      const outcome = await upsertCanonicalLeadWithOutcome(leadWith(undefined, P2));
      expect(outcome.status).toBe('persisted');
      const { rows } = await db.query(
        `SELECT display IS NULL AS n FROM ${TABLE} WHERE id = $1`, [outcome.leadId],
      );
      expect(rows[0].n).toBe(true);
      const view = await getCanonicalLead(ORG_A, outcome.leadId as string);
      expect((view as any).display).toBeUndefined();
    });
  });

  it('searchLeads returns the stored display and finds the lead BY NAME and BY TITLE', async () => {
    await inRollback(async () => {
      await seedTenants();
      const outcome = await upsertCanonicalLeadWithOutcome(
        leadWith({ name: 'Grace Hopper', title: 'Rear Admiral', contentText: null }, P3),
      );
      expect(outcome.status).toBe('persisted');

      const all = await searchLeads({ companyId: ORG_A }, defaultLeadSourceReaders);
      // Not a degraded read: `unavailable` here would mean the provenance pass
      // failed and this test had proven less than it claims.
      expect(all.provenance).toBe('ok');
      const mine = all.rows.find((v: any) => v.sourceRef && v.sourceRef.id === P3);
      expect(mine).toBeTruthy();
      expect((mine as any).display).toEqual({ name: 'Grace Hopper', title: 'Rear Admiral', contentText: null });

      // The point of the column: a name search reaches the lead. Before
      // PI-LDB-4 the search haystack held no name for an adapter-ingested lead.
      const byName = await searchLeads({ companyId: ORG_A, search: 'grace hopper' }, defaultLeadSourceReaders);
      expect(byName.rows.map((v: any) => v.sourceRef && v.sourceRef.id)).toContain(P3);
      const byTitle = await searchLeads({ companyId: ORG_A, search: 'rear admiral' }, defaultLeadSourceReaders);
      expect(byTitle.rows.map((v: any) => v.sourceRef && v.sourceRef.id)).toContain(P3);
      const byNothing = await searchLeads({ companyId: ORG_A, search: 'zzz-no-such-lead' }, defaultLeadSourceReaders);
      expect(byNothing.rows.map((v: any) => v.sourceRef && v.sourceRef.id)).not.toContain(P3);
    });
  });

  it('a scalar display is refused end-to-end, classified `invalid`, and nothing is stored', async () => {
    await inRollback(async () => {
      await seedTenants();
      const outcome = await upsertCanonicalLeadWithOutcome(leadWith('Ada Lovelace', P4));
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toBe('invalid');
      expect(outcome.leadId).toBeNull();
      const { rows } = await db.query(
        `SELECT count(*)::int c FROM ${TABLE} WHERE company_id = $1 AND source_id = $2`, [ORG_A, P4],
      );
      expect(rows[0].c).toBe(0);
    });
  });
});

describe('PI-LDB-4 — the column MISSING (migration 20270201000003 unapplied)', () => {
  it('at the database level, a write naming display raises 42703', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
      const code = await attempt(
        `INSERT INTO ${TABLE} (company_id, dedupe_key, source, display)
         VALUES ($1, 'dk-x', 'import', '{}'::jsonb)`, [ORG_A],
      );
      expect(code).toBe('42703');
      // The CHECK and the index go with the column: nothing else holds the shape.
      expect(await constraintDef(CHECK)).toBeNull();
      const { rows } = await db.query(
        'SELECT count(*)::int c FROM pg_indexes WHERE indexname = $1', [INDEX],
      );
      expect(rows[0].c).toBe(0);
    });
  });

  it('at the application level, the real repository says `schema_not_applied` and persists nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);

      const outcome = await upsertCanonicalLeadWithOutcome(
        leadWith({ name: 'Ada Lovelace', title: null, contentText: null }, PM),
      );
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toBe('schema_not_applied');
      expect(outcome.leadId).toBeNull();

      // NOT persisted — the whole row, not just the label. `display` is in the
      // same INSERT as identity and attribution, so a missing column loses the
      // ENTIRE lead rather than degrading to a nameless one.
      const { rows } = await db.query(
        `SELECT count(*)::int c FROM ${TABLE} WHERE company_id = $1 AND source_id = $2`,
        [ORG_A, PM],
      );
      expect(rows[0].c).toBe(0);
    });
  });

  it('PostgREST own code for this cause classifies identically', async () => {
    // The harness produces 42703 because it speaks libpq. Production speaks
    // PostgREST, which answers PGRST204 ("column not found in the schema
    // cache") for the same cause. Both must land on the same verdict, or the
    // operator is sent to look at the data instead of at the migration.
    for (const code of ['42703', 'PGRST204', '42P01', 'PGRST205']) {
      const v = classifyWriteOutcome({ code, message: 'x', status: 400 });
      expect(v.status).toBe('failed');
      expect(v.reason).toBe('schema_not_applied');
    }
  });
});
