/**
 * G-6 — the enrichment attempt ledger is tenant-coupled, and that refusal happens
 * BEFORE the provider is contacted.
 *
 * ─── WHAT G-3 FOUND, AND WHY "canonical is safe" WAS NOT ENOUGH ────────────
 * Before this migration, tenant A enriching tenant B's account inserted an attempt
 * row (organization_id = A, account_id = B's), CALLED the provider, and only then
 * had its evidence insert refused downstream. Canonical data was never wrong — but
 * tenant A's credential had already been spent on a call about tenant B's account.
 *
 * So the guarantee this file proves is about ORDER, not about outcome. It is not
 * enough to assert that canonical data is unchanged; the provider must never be
 * reached at all. `safeFetch` is therefore a TRIPWIRE: any cross-tenant test that
 * reaches transport fails loudly with a distinctive error rather than passing on a
 * technicality.
 *
 * Only the network is stubbed. The recorder, the lease, the executor, the adapter,
 * LI-2 persistence, B1b arbitration and the schema are all real.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

import { db, inRollback, seedTenants, ORG_A, ORG_B, newAccount, newPerson, attempt } from './setup';

jest.mock('../../services/enrichment/productionPorts', () => ({
  __esModule: true,
  makeProductionEnrichmentPorts: () => {
    throw new Error('productionPorts must never be constructed in this suite — ports are supplied explicitly');
  },
}));

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter =
      | { kind: 'eq' | 'is' | 'lt'; col: string; val: unknown }
      | { kind: 'in'; col: string; val: unknown[] }
      | { kind: 'array'; col: string; val: unknown }
      | { kind: 'raw'; sql: string; args: unknown[] };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], order: null as { col: string; asc: boolean } | null,
      limit: null as number | null, mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const translateOr = (expr: string, params: unknown[]): string => {
      const simple = /^claimed_until\.lt\.(.+)$/.exec(expr);
      if (simple) { params.push(simple[1]); return `("claimed_until" < $${params.length})`; }
      const both = /^claimed_until\.lt\.([^,]+),and\(claimed_until\.is\.null,started_at\.lt\.([^)]+)\)$/.exec(expr);
      if (both) {
        params.push(both[1]);
        const a = `"claimed_until" < $${params.length}`;
        params.push(both[2]);
        return `(${a} OR ("claimed_until" IS NULL AND "started_at" < $${params.length}))`;
      }
      throw new Error(`pg adapter: unsupported or() expression, refusing to guess: ${expr}`);
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.kind === 'raw') { for (const a of f.args) params.push(a); return f.sql; }
        if (f.kind === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.kind === 'in') {
          const list = f.val.map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
        if (f.kind === 'array') { params.push(f.val); return `"${f.col}" = $${params.length}::text[]`; }
        if (f.kind === 'lt') { params.push(f.val); return `"${f.col}" < $${params.length}`; }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      let sql: string;
      const render = (v: unknown) =>
        (Array.isArray(v) ? v : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => { params.push(render(row[k])); return `$${params.length}`; }).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          params.push(render(row[k])); return `"${k}" = $${params.length}`;
        }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (row: Record<string, unknown>) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Record<string, unknown>) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ kind: 'eq', col, val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ kind: 'is', col, val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ kind: 'in', col, val }); return b; },
      lt: (col: string, val: unknown) => { st.filters.push({ kind: 'lt', col, val }); return b; },
      filter: (col: string, op: string, val: unknown) => {
        if (op !== 'eq') throw new Error(`pg adapter: unsupported filter op ${op}`);
        st.filters.push({ kind: 'array', col, val }); return b;
      },
      or: (expr: string) => {
        const args: unknown[] = [];
        st.filters.push({ kind: 'raw', sql: translateOr(expr, args), args });
        return b;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        st.order = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
  /**
   * The RPC leg of the write seam, onto the SAME live connection — the same
   * double b1b_arbitration.test.ts uses. The boundary's final canonical write
   * goes through `ownedDbRpc('pi_apply_canonical_decisions', ...)`
   * (20261128000000_pi_canonical_write_atomicity.sql), so without this the
   * boundary would throw before any canonical write reached the database.
   * Named-argument form lets PostgreSQL type each parameter from the function
   * signature (JSON string -> jsonb, ISO string -> timestamptz).
   */
  ownedDbRpc: async (fn: string, args: Record<string, unknown>) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    await client.query('SAVEPOINT pg_rpc');
    try {
      const res = await client.query(
        `SELECT public."${fn}"(${named}) AS result`, params,
      ) as { rows: Array<{ result: unknown }> };
      await client.query('RELEASE SAVEPOINT pg_rpc');
      return { data: res.rows[0]?.result ?? null, error: null };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT pg_rpc');
      return { data: null, error: err };
    }
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { safeFetch } = require('../../../lib/security/safeFetch');
const { executeEnrichmentRecorded } = require('../../services/enrichment/recordedExecution');
const { apolloEnrichmentAdapter } = require('../../services/enrichment/providers/adapters/apollo');
const { defaultPersistObservation } = require('../../services/enrichment/providers/persistence');
/* eslint-enable @typescript-eslint/no-var-requires */

const fetchMock = safeFetch as jest.Mock;
const SECRET = 'synthetic-tenant-apollo-key';
const LEASE = { claimedBy: 'worker-g6', ttlMs: 60_000 };
const TRIPWIRE = 'G-6 VIOLATION: the provider was reached on a cross-tenant attempt';

const ok = (body: unknown) => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => body,
});

/** Records what each port was asked to do, so "no cost was authorized" is provable. */
function instrumentedPorts() {
  const cost: Array<{ organizationId: string }> = [];
  const credential: Array<{ organizationId: string }> = [];
  const persisted: Array<{ organizationId: string }> = [];
  const ports = {
    async authorizeCost(input: { organizationId: string }) {
      cost.push({ organizationId: input.organizationId });
      return { authorized: true, holdId: 'hold-g6', cost: { currency: 'USD', amount: 0 } };
    },
    async releaseCost() { /* nothing billable in these cases */ },
    async resolveCredential(input: { organizationId: string }) {
      credential.push({ organizationId: input.organizationId });
      return SECRET;
    },
    async findRecentObservation() { return null; },
    async persistObservation(input: { organizationId: string }) {
      persisted.push({ organizationId: input.organizationId });
      return defaultPersistObservation(input as never);
    },
    now() { return new Date().toISOString(); },
  };
  return { ports, cost, credential, persisted };
}

const run = (
  org: string, subject: 'person' | 'account', entityId: string,
  attributes: readonly string[], ports: unknown,
) => executeEnrichmentRecorded({
  organizationId: org,
  subject,
  entityId,
  attributes,
  selectors: { domain: 'example.com' },
  purpose: 'g6-tenant-fk',
  correlationId: 'corr-g6',
}, 'apollo', ports, {
  adapter: apolloEnrichmentAdapter,
  lease: LEASE,
  requireAttemptRecord: true,
});

const attemptsIn = async (org: string) => {
  const { rows } = await db.query(
    `SELECT id, organization_id, account_id, person_id, provider_called, provider_call_state
       FROM public.prospect_enrichment_attempts WHERE organization_id=$1`, [org]);
  return rows as Array<Record<string, unknown>>;
};
const countOf = async (accountId: string) => {
  const { rows } = await db.query(
    'SELECT employee_count FROM public.prospect_accounts WHERE id=$1', [accountId]);
  return rows[0]?.employee_count ?? null;
};
const tally = async (org: string) => {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM public.prospect_enrichment_attempts WHERE organization_id=$1) attempts,
            (SELECT count(*)::int FROM public.source_records       WHERE organization_id=$1) records,
            (SELECT count(*)::int FROM public.source_assertions    WHERE organization_id=$1) assertions,
            (SELECT count(*)::int FROM public.canonical_attribute_decisions WHERE organization_id=$1) decisions`,
    [org]);
  return rows[0] as Record<string, number>;
};

beforeAll(async () => { await seedTenants(); });
beforeEach(() => { fetchMock.mockReset(); });

// ════════════════════════════════════════════════════════════════════════════
describe('G-6 §8 — structural proof, read from the PostgreSQL catalog', () => {
  it('both entity keys are composite and carry organization_id', async () => {
    const { rows } = await db.query(`
      SELECT conname, array_length(con.conkey,1) AS cols, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE s.relname='prospect_enrichment_attempts' AND con.contype='f'
         AND con.conname IN ('prospect_enrichment_attempts_account_tenant_fk',
                             'prospect_enrichment_attempts_person_tenant_fk')
       ORDER BY conname`);
    expect(rows).toHaveLength(2);
    for (const r of rows as any[]) {
      expect(Number(r.cols)).toBe(2);
      expect(r.def).toMatch(/, organization_id\)/);
    }
    const byName = Object.fromEntries((rows as any[]).map((r) => [r.conname, r.def]));
    expect(byName.prospect_enrichment_attempts_account_tenant_fk)
      .toMatch(/REFERENCES prospect_accounts\(id, organization_id\)/);
    // unified_persons' tenant column is `company_id`, so the parent key is spelled
    // that way — exactly as source_records and source_assertions already do.
    expect(byName.prospect_enrichment_attempts_person_tenant_fk)
      .toMatch(/REFERENCES unified_persons\(id, company_id\)/);
  });

  it('the old single-column entity keys are GONE', async () => {
    const { rows } = await db.query(`
      SELECT conname FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE s.relname='prospect_enrichment_attempts' AND con.contype='f'
         AND con.conname IN ('prospect_enrichment_attempts_account_id_fkey',
                             'prospect_enrichment_attempts_person_id_fkey')`);
    expect(rows).toHaveLength(0);
  });

  it('ON DELETE CASCADE and the lease indexes were preserved', async () => {
    const { rows } = await db.query(`
      SELECT count(*)::int n FROM pg_constraint
       WHERE conname IN ('prospect_enrichment_attempts_account_tenant_fk',
                         'prospect_enrichment_attempts_person_tenant_fk')
         AND confdeltype = 'c'`);
    expect(rows[0].n).toBe(2);
    const idx = await db.query(`
      SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public'
         AND indexname IN ('prospect_enrichment_attempts_person_live',
                           'prospect_enrichment_attempts_account_live',
                           'prospect_enrichment_attempts_person_unique',
                           'prospect_enrichment_attempts_account_unique')`);
    expect(idx.rows[0].n).toBe(4);
  });

  it('the attempt ledger now matches the rest of the chain', async () => {
    // The table that G-3 reported as the only one with zero composite tenant FKs.
    const { rows } = await db.query(`
      SELECT s.relname AS table_name,
             count(*) FILTER (WHERE array_length(con.conkey,1)=2)::int AS composite
        FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname IN ('source_records','source_assertions',
                 'canonical_attribute_decisions','prospect_enrichment_attempts')
       GROUP BY s.relname ORDER BY s.relname`);
    const byTable = Object.fromEntries(
      (rows as Array<{ table_name: string; composite: number }>)
        .map((r) => [r.table_name, Number(r.composite)]));
    expect(byTable.prospect_enrichment_attempts).toBe(2);   // was 0
    expect(byTable.source_records).toBe(2);
    // 4, not 3: record, person, account + the relationship leg
    // (source_assertions_relationship_tenant_fk) added on this branch by
    // 20261122000000_pi_person_account_relationships.sql (re-created with
    // SET NULL (relationship_id) by 20261125000000_pi_relationship_evidence_detachment.sql).
    expect(byTable.source_assertions).toBe(4);
    // 4, not 3: assertion, person, account + the relationship leg
    // (canonical_decisions_relationship_tenant_fk) added on this branch by
    // 20261124000000_pi_relationship_canonical_decisions.sql.
    expect(byTable.canonical_attribute_decisions).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-6 §5 — a cross-tenant attempt fails BEFORE the provider is reached', () => {
  it('ACCOUNT, A -> B: refused at the attempt boundary, provider never contacted', async () => {
    await inRollback(async () => {
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      // TRIPWIRE: reaching transport is itself the failure.
      fetchMock.mockImplementation(async () => { throw new Error(TRIPWIRE); });
      const { ports, cost, credential, persisted } = instrumentedPorts();

      let threw: unknown = null;
      try { await run(ORG_A, 'account', accB, ['employee_count'], ports); } catch (e) { threw = e; }

      // 1. the database rejected the relationship
      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(String(threw)).not.toContain(TRIPWIRE);
      // 3. provider transport NEVER happened
      expect(fetchMock).not.toHaveBeenCalled();
      // 4. no cost authorised, and the credential was never even resolved
      expect(cost).toHaveLength(0);
      expect(credential).toHaveLength(0);
      expect(persisted).toHaveLength(0);
      // 2, 5, 6, 7, 8 — nothing survives anywhere, for either tenant
      expect(await attemptsIn(ORG_A)).toHaveLength(0);
      expect(await attemptsIn(ORG_B)).toHaveLength(0);
      expect(await tally(ORG_A)).toEqual({ attempts: 0, records: 0, assertions: 0, decisions: 0 });
      expect(await tally(ORG_B)).toEqual({ attempts: 0, records: 0, assertions: 0, decisions: 0 });
      expect(await countOf(accB)).toBeNull();
    });
  });

  it('ACCOUNT, B -> A: the mirror case is refused identically', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockImplementation(async () => { throw new Error(TRIPWIRE); });
      const { ports, cost } = instrumentedPorts();

      let threw: unknown = null;
      try { await run(ORG_B, 'account', accA, ['employee_count'], ports); } catch (e) { threw = e; }

      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cost).toHaveLength(0);
      expect(await attemptsIn(ORG_B)).toHaveLength(0);
      expect(await countOf(accA)).toBeNull();
    });
  });

  it('PERSON, A -> B: refused at the attempt boundary, provider never contacted', async () => {
    await inRollback(async () => {
      const personB = await newPerson(ORG_B);
      fetchMock.mockImplementation(async () => { throw new Error(TRIPWIRE); });
      const { ports, cost, credential } = instrumentedPorts();

      let threw: unknown = null;
      try { await run(ORG_A, 'person', personB, ['job_title'], ports); } catch (e) { threw = e; }

      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cost).toHaveLength(0);
      expect(credential).toHaveLength(0);
      expect(await attemptsIn(ORG_A)).toHaveLength(0);
      expect(await attemptsIn(ORG_B)).toHaveLength(0);
    });
  });

  it('PERSON, B -> A: the mirror case is refused identically', async () => {
    await inRollback(async () => {
      const personA = await newPerson(ORG_A);
      fetchMock.mockImplementation(async () => { throw new Error(TRIPWIRE); });
      const { ports, cost } = instrumentedPorts();

      let threw: unknown = null;
      try { await run(ORG_B, 'person', personA, ['job_title'], ports); } catch (e) { threw = e; }

      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cost).toHaveLength(0);
      expect(await attemptsIn(ORG_B)).toHaveLength(0);
    });
  });

  it('the refusal is the ATTEMPT INSERT itself, not something later', async () => {
    await inRollback(async () => {
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      // Proven directly against the schema: the row the ledger would write is
      // rejected by the composite key, independently of any application code.
      const { rows } = await db.query(
        'SELECT id FROM public.prospect_accounts WHERE id=$1', [accB]);
      expect(rows).toHaveLength(1);                   // the account really exists...
      expect(await attempt(
        `INSERT INTO public.prospect_enrichment_attempts
           (organization_id, account_id, provider_key, requested_attributes,
            attempt_number, correlation_id, started_at)
         VALUES ($1,$2,'apollo','{employee_count}',1,'c',now())`,
        [ORG_A, accB])).toBe('23503');                // ...and A still cannot name it
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-6 §6 — valid same-tenant enrichment is unaffected', () => {
  it('Case A — tenant A enriches its own account, end to end', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const { ports, cost, persisted } = instrumentedPorts();

      const { result, attemptId } = await run(ORG_A, 'account', accA, ['employee_count'], ports);

      expect(result.outcome).toBe('enriched');
      expect(attemptId).toBeTruthy();
      expect(cost).toHaveLength(1);
      expect(persisted).toHaveLength(1);
      expect(await countOf(accA)).toBe(4200);
      const t = await tally(ORG_A);
      expect(t).toMatchObject({ attempts: 1, records: 1, assertions: 1, decisions: 1 });
    });
  });

  it('Case B — tenant B enriches its own account, end to end', async () => {
    await inRollback(async () => {
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 777 } }));
      const { ports } = instrumentedPorts();

      const { result } = await run(ORG_B, 'account', accB, ['employee_count'], ports);
      expect(result.outcome).toBe('enriched');
      expect(await countOf(accB)).toBe(777);
      expect(await tally(ORG_B)).toMatchObject({ attempts: 1, records: 1, assertions: 1, decisions: 1 });
    });
  });

  it('Case C — both tenants enrich the SAME external domain without contention', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      const accB = await newAccount(ORG_B, { domain: 'example.com' });

      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      await run(ORG_A, 'account', accA, ['employee_count'], instrumentedPorts().ports);
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 9999 } }));
      await run(ORG_B, 'account', accB, ['employee_count'], instrumentedPorts().ports);

      expect(await countOf(accA)).toBe(4200);
      expect(await countOf(accB)).toBe(9999);
      // One attempt each, in each tenant's own namespace.
      expect(await attemptsIn(ORG_A)).toHaveLength(1);
      expect(await attemptsIn(ORG_B)).toHaveLength(1);
    });
  });

  it('Case D — tenant A may open an attempt against its own PERSON', async () => {
    await inRollback(async () => {
      const personA = await newPerson(ORG_A);
      fetchMock.mockResolvedValue(ok({ organization: {} }));
      const { ports } = instrumentedPorts();

      // The attempt RELATIONSHIP is what G-6 governs. Apollo answers no person
      // attribute, so the enrichment itself refuses for an unrelated reason — that
      // is `provider_declined`/`field_not_found` territory and not a G-6 concern.
      const { attemptId } = await run(ORG_A, 'person', personA, ['job_title'], ports);

      expect(attemptId).toBeTruthy();
      const rows = await attemptsIn(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBe(personA);
      expect(rows[0].account_id).toBeNull();
    });
  });

  it('Case E — tenant B may open an attempt against its own PERSON', async () => {
    await inRollback(async () => {
      const personB = await newPerson(ORG_B);
      fetchMock.mockResolvedValue(ok({ organization: {} }));
      const { attemptId } = await run(ORG_B, 'person', personB, ['job_title'], instrumentedPorts().ports);
      expect(attemptId).toBeTruthy();
      const rows = await attemptsIn(ORG_B);
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBe(personB);
    });
  });

  it('a NULL entity leg still satisfies the other composite key', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      // An account attempt has person_id NULL. Under MATCH SIMPLE a composite key
      // with any NULL column is satisfied, which is why one attempt can name one
      // entity kind without tripping the other key.
      expect(await attempt(
        `INSERT INTO public.prospect_enrichment_attempts
           (organization_id, account_id, provider_key, requested_attributes,
            attempt_number, correlation_id, started_at)
         VALUES ($1,$2,'apollo','{employee_count}',1,'c',now())`,
        [ORG_A, accA])).toBe('ok');
    });
  });
});
