/**
 * B2 / G-3 — the attempt ledger and lease, COMPOSED with the B1b write path.
 *
 * B2 verified Apollo → assertion → arbitration → canonical → decision. It drove
 * `executeEnrichment` directly, so the attempt ledger and the lease were never in
 * the loop. G-3 is that gap, and this file closes it by driving the path the
 * automated caller actually uses:
 *
 *   executeEnrichmentRecorded(..., { lease, requireAttemptRecord: true })
 *     → claimEnrichmentWork        (atomic, arbitrated by the live partial index)
 *     → markProviderCallPending    (durable `unknown` BEFORE transport)
 *     → executeEnrichment          → Apollo adapter → persistObservation
 *                                  → ingestSourceRecord → B1b → canonical
 *     → completeAttempt            (settlement)
 *
 * REAL: the recorder, the lease, the executor, the adapter, LI-2 persistence, B1b
 * arbitration and the schema. STUBBED: only `safeFetch`, so no Apollo key exists
 * in this process and nothing leaves it.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

import { db, inRollback, seedTenants, ORG_A, ORG_B, newAccount } from './setup';

/**
 * `recordedExecution` defaults its `ports` parameter to `makeProductionEnrichmentPorts()`,
 * which pulls in the credential store and, through it, a `@/config` alias the
 * real-schema jest config does not map. This suite ALWAYS supplies ports
 * explicitly, so the default is never used — and stubbing it to THROW turns that
 * from an assumption into a guarantee: if any path here ever fell back to the
 * production composition, the test would fail loudly rather than quietly reach
 * for a real credential store.
 */
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

    /**
     * Translate the ONE PostgREST `or(...)` shape the reclaim path uses, and
     * REFUSE anything else.
     *
     * A general parser would be the wrong instrument here: if the production
     * predicate changes shape, a lenient translator would quietly test a
     * different condition and still pass. Refusing makes that a loud failure.
     */
    const translateOr = (expr: string, params: unknown[]): string => {
      const simple = /^claimed_until\.lt\.(.+)$/.exec(expr);
      if (simple) {
        params.push(simple[1]);
        return `("claimed_until" < $${params.length})`;
      }
      const both = /^claimed_until\.lt\.([^,]+),and\(claimed_until\.is\.null,started_at\.lt\.([^)]+)\)$/.exec(expr);
      if (both) {
        params.push(both[1]);
        const a = `"claimed_until" < $${params.length}`;
        params.push(both[2]);
        const b = `("claimed_until" IS NULL AND "started_at" < $${params.length})`;
        return `(${a} OR ${b})`;
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
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => {
          const v = row[k];
          params.push(Array.isArray(v) ? v : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
          return `$${params.length}`;
        }).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          const v = row[k];
          params.push(Array.isArray(v) ? v : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
          return `"${k}" = $${params.length}`;
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
        st.filters.push({ kind: 'array', col, val });
        return b;
      },
      or: (expr: string) => {
        const args: unknown[] = [];
        const sql = translateOr(expr, args);
        st.filters.push({ kind: 'raw', sql, args });
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

// Imported AFTER the mocks so the real code picks them up.
/* eslint-disable @typescript-eslint/no-var-requires */
const { safeFetch } = require('../../../lib/security/safeFetch');
const {
  executeEnrichmentRecorded, EnrichmentWorkClaimedError,
} = require('../../services/enrichment/recordedExecution');
const { apolloEnrichmentAdapter } = require('../../services/enrichment/providers/adapters/apollo');
const { defaultPersistObservation } = require('../../services/enrichment/providers/persistence');
const { claimEnrichmentWork } = require('../../services/enrichment/attempts');
/* eslint-enable @typescript-eslint/no-var-requires */

const fetchMock = safeFetch as jest.Mock;
const SECRET = 'synthetic-tenant-apollo-key';
const LEASE = { claimedBy: 'worker-g3', ttlMs: 60_000 };

const ok = (body: unknown) => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => body,
});
const notOk = (status: number) => ({
  ok: false, status, headers: { get: () => null }, json: async () => ({}),
});

const ports = (over: Record<string, unknown> = {}) => ({
  async authorizeCost() { return { authorized: true, holdId: 'hold-g3', cost: { currency: 'USD', amount: 0 } }; },
  async releaseCost() { /* nothing billable to release here */ },
  async resolveCredential() { return SECRET; },
  async findRecentObservation() { return null; },
  persistObservation: defaultPersistObservation,     // REAL -> ingestSourceRecord -> B1b
  now() { return new Date().toISOString(); },
  ...over,
});

/** The AUTOMATED posture: leased and fail-closed, exactly as consumeEnrichmentWork does. */
const runLeased = (org: string, accountId: string, over: Record<string, unknown> = {}, portsOver = {}) =>
  executeEnrichmentRecorded({
    organizationId: org,
    subject: 'account',
    entityId: accountId,
    attributes: ['employee_count'],
    selectors: { domain: 'example.com' },
    purpose: 'g3-composition',
    correlationId: 'corr-g3',
  }, 'apollo', ports(portsOver), {
    adapter: apolloEnrichmentAdapter,
    lease: LEASE,
    requireAttemptRecord: true,
    ...over,
  });

const attemptsFor = async (accountId: string) => {
  const { rows } = await db.query(
    `SELECT id, organization_id, account_id, person_id, provider_key, attempt_number,
            outcome, provider_called, provider_call_state, execution_status,
            claimed_by, claimed_until, completed_at, source_record_id, next_retry_at
       FROM public.prospect_enrichment_attempts
      WHERE account_id=$1 ORDER BY attempt_number`, [accountId]);
  return rows as Array<Record<string, unknown>>;
};
const countOf = async (accountId: string) => {
  const { rows } = await db.query(
    'SELECT employee_count FROM public.prospect_accounts WHERE id=$1', [accountId]);
  return rows[0]?.employee_count ?? null;
};
const assertionsFor = async (accountId: string) => {
  const { rows } = await db.query(
    `SELECT id, provider, normalized_value, applied_reason FROM public.source_assertions
      WHERE account_id=$1 AND attribute='employee_count'`, [accountId]);
  return rows as Array<Record<string, unknown>>;
};
const decisionsFor = async (accountId: string) => {
  const { rows } = await db.query(
    `SELECT value, reason FROM public.canonical_attribute_decisions
      WHERE account_id=$1 ORDER BY decided_at`, [accountId]);
  return rows as Array<Record<string, unknown>>;
};

beforeAll(async () => { await seedTenants(); });
beforeEach(() => { fetchMock.mockReset(); });

// ════════════════════════════════════════════════════════════════════════════
describe('G-3 A..H — the whole composed sequence, in one pass', () => {
  it('attempt → lease → provider → assertion → arbitration → canonical → provenance → settlement', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));

      const { result, attemptId, attemptNumber } = await runLeased(ORG_A, acc);

      // A + B — the attempt exists and the lease was taken.
      expect(attemptId).toBeTruthy();
      expect(attemptNumber).toBe(1);
      const attempts = await attemptsFor(acc);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].organization_id).toBe(ORG_A);
      expect(attempts[0].provider_key).toBe('apollo');
      expect(attempts[0].claimed_by).toBe('worker-g3');
      expect(attempts[0].claimed_until).not.toBeNull();

      // C — Apollo was contacted exactly once (simulated transport).
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.providerCalled).toBe(true);
      expect(result.outcome).toBe('enriched');

      // D + E + F — evidence, arbitration, canonical.
      const assertions = await assertionsFor(acc);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].provider).toBe('apollo');
      expect(assertions[0].normalized_value).toBe('4200');
      expect(await countOf(acc)).toBe(4200);

      // G — provenance, on both surfaces.
      expect(assertions[0].applied_reason).toBe('single_uncontested_assertion');
      const decisions = await decisionsFor(acc);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ value: '4200', reason: 'single_uncontested_assertion' });

      // H — the attempt settled, and settled TRUTHFULLY.
      const settled = (await attemptsFor(acc))[0];
      expect(settled.completed_at).not.toBeNull();
      expect(settled.outcome).toBe('enriched');
      expect(settled.provider_called).toBe(true);
      expect(settled.provider_call_state).toBe('called');
      expect(settled.execution_status).toBe('completed');
      // The attempt names the evidence it produced, which is what links the two
      // ledgers together.
      expect(settled.source_record_id).toBe(result.sourceRecordId);
    });
  });

  it('the pre-transport mark is durable, so a crash cannot be read as "never called"', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      // Observe the row at the moment transport is entered.
      let stateAtTransport: unknown = 'not-observed';
      fetchMock.mockImplementation(async () => {
        const { rows } = await db.query(
          `SELECT provider_call_state FROM public.prospect_enrichment_attempts WHERE account_id=$1`, [acc]);
        stateAtTransport = rows[0]?.provider_call_state;
        return ok({ organization: { estimated_num_employees: 4200 } });
      });

      await runLeased(ORG_A, acc);

      // A4Q: written BEFORE egress, so a process death in that window leaves
      // `unknown` rather than a row claiming no call was made.
      expect(stateAtTransport).toBe('unknown');
      // And overwritten by the proven answer on completion.
      expect((await attemptsFor(acc))[0].provider_call_state).toBe('called');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-3 failure paths — a failed attempt NEVER produces canonical evidence', () => {
  const failures: Array<[string, () => void, string, boolean]> = [
    // label, arrange, expected outcome, provider actually contacted
    ['no_match', () => fetchMock.mockResolvedValue(notOk(404)), 'no_match', true],
    ['provider_error', () => fetchMock.mockResolvedValue(notOk(500)), 'provider_unavailable', true],
    ['rate_limited', () => fetchMock.mockResolvedValue(notOk(429)), 'rate_limited', true],
    ['timeout', () => fetchMock.mockRejectedValue(new Error('request timed out')), 'timeout', true],
  ];

  for (const [label, arrange, expected, called] of failures) {
    it(`${label}: attempt records it, canonical records nothing`, async () => {
      await inRollback(async () => {
        const acc = await newAccount(ORG_A, { domain: 'example.com' });
        arrange();

        const { result } = await runLeased(ORG_A, acc);
        expect(result.outcome).toBe(expected);

        // No evidence, no canonical value, no decision — our failure is not a
        // fact about the account.
        expect(await assertionsFor(acc)).toHaveLength(0);
        expect(await countOf(acc)).toBeNull();
        expect(await decisionsFor(acc)).toHaveLength(0);
        const { rows } = await db.query(
          `SELECT count(*)::int n FROM public.source_records WHERE organization_id=$1`, [ORG_A]);
        expect(rows[0].n).toBe(0);

        // But the attempt is settled and truthful.
        const a = (await attemptsFor(acc))[0];
        expect(a.completed_at).not.toBeNull();
        expect(a.outcome).toBe(expected);
        expect(a.provider_called).toBe(called);
        expect(a.provider_call_state).toBe(called ? 'called' : 'not_called');
        expect(a.execution_status).toBe(called ? 'completed' : 'refused_pre_call');
        expect(a.source_record_id).toBeNull();
      });
    });
  }

  it('credential_missing: no transport, no evidence, and the attempt says so', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      const { result } = await runLeased(ORG_A, acc, {}, { async resolveCredential() { return null; } });

      expect(result.outcome).toBe('credential_missing');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await assertionsFor(acc)).toHaveLength(0);
      expect(await countOf(acc)).toBeNull();

      const a = (await attemptsFor(acc))[0];
      expect(a.outcome).toBe('credential_missing');
      expect(a.provider_called).toBe(false);
      expect(a.provider_call_state).toBe('not_called');
      expect(a.execution_status).toBe('refused_pre_call');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-3 CASES 1..6 — retry, lease and replay', () => {
  it('CASE 1 — a successful attempt records the execution exactly once', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      await runLeased(ORG_A, acc);
      expect(await attemptsFor(acc)).toHaveLength(1);
      expect(await decisionsFor(acc)).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('CASE 2 — a retryable provider failure settles retryable, and writes no canonical value', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(notOk(429));
      const { result } = await runLeased(ORG_A, acc);
      expect(result.outcome).toBe('rate_limited');
      const a = (await attemptsFor(acc))[0];
      // Settled, with the provider's verdict and no invented retry horizon:
      // this response carried no Retry-After header.
      expect(a.completed_at).not.toBeNull();
      expect(a.next_retry_at).toBeNull();
      expect(await countOf(acc)).toBeNull();
      expect(await decisionsFor(acc)).toHaveLength(0);
    });
  });

  it('CASE 3 — a retry is a NEW numbered attempt, and produces no duplicate decision', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      // First try fails; the lease is released by settlement.
      fetchMock.mockResolvedValue(notOk(429));
      await runLeased(ORG_A, acc);
      // Retry succeeds.
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const second = await runLeased(ORG_A, acc);

      expect(second.attemptNumber).toBe(2);
      const attempts = await attemptsFor(acc);
      expect(attempts.map((a) => a.attempt_number)).toEqual([1, 2]);
      expect(attempts.map((a) => a.outcome)).toEqual(['rate_limited', 'enriched']);
      // One canonical value, ONE decision — the retry did not duplicate it.
      expect(await countOf(acc)).toBe(4200);
      expect(await decisionsFor(acc)).toHaveLength(1);
      expect(await assertionsFor(acc)).toHaveLength(1);
    });
  });

  it('CASE 4 — a second worker cannot claim a live lease', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      const now = new Date().toISOString();
      const until = new Date(Date.now() + 60_000).toISOString();

      // Worker one claims and does NOT settle: the attempt stays live.
      const first = await claimEnrichmentWork({
        organizationId: ORG_A, subject: 'account', entityId: acc, providerId: 'apollo',
        requestedAttributes: ['employee_count'], correlationId: 'c1',
        attemptNumber: 1, startedAt: now, claimedBy: 'worker-one', claimedUntil: until,
      });
      expect('attemptId' in first).toBe(true);

      // Worker two arrives while that lease is live and must be refused.
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      await expect(runLeased(ORG_A, acc)).rejects.toThrow(EnrichmentWorkClaimedError);

      // The loser performed NO transport and wrote nothing.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await attemptsFor(acc)).toHaveLength(1);
      expect(await countOf(acc)).toBeNull();
      expect(await assertionsFor(acc)).toHaveLength(0);
    });
  });

  it('CASE 5 — replaying identical provider evidence stays idempotent', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      await runLeased(ORG_A, acc);
      await runLeased(ORG_A, acc);
      await runLeased(ORG_A, acc);

      // Three attempts — each execution is a real, separately recorded event.
      expect(await attemptsFor(acc)).toHaveLength(3);
      // But ONE assertion and ONE decision: the evidence layer deduplicates and
      // B1b writes nothing once its verdict is already in force.
      expect(await assertionsFor(acc)).toHaveLength(1);
      expect(await decisionsFor(acc)).toHaveLength(1);
      expect(await countOf(acc)).toBe(4200);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_records WHERE organization_id=$1 AND provider='apollo'`,
        [ORG_A]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('CASE 6 — a terminal failure produces no canonical evidence at all', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      // 401 is terminal: the provider refused the credential.
      fetchMock.mockResolvedValue(notOk(401));
      const { result } = await runLeased(ORG_A, acc);
      expect(result.outcome).toBe('provider_unavailable');
      expect(await countOf(acc)).toBeNull();
      expect(await assertionsFor(acc)).toHaveLength(0);
      expect(await decisionsFor(acc)).toHaveLength(0);
      expect((await attemptsFor(acc))[0].completed_at).not.toBeNull();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G-3 tenant isolation — every row in the composition belongs to one tenant', () => {
  it('attempt, lease, evidence, canonical and decision are all tenant A', async () => {
    await inRollback(async () => {
      const acc = await newAccount(ORG_A, { domain: 'example.com' });
      fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
      const { result } = await runLeased(ORG_A, acc);

      const rows = await db.query(
        `SELECT 'attempt' AS t, organization_id FROM public.prospect_enrichment_attempts WHERE account_id=$1
         UNION ALL SELECT 'source_record', organization_id FROM public.source_records WHERE id=$2
         UNION ALL SELECT 'assertion', organization_id FROM public.source_assertions WHERE account_id=$1
         UNION ALL SELECT 'decision', organization_id FROM public.canonical_attribute_decisions WHERE account_id=$1
         UNION ALL SELECT 'account', organization_id FROM public.prospect_accounts WHERE id=$1`,
        [acc, result.sourceRecordId]);
      expect(rows.rows.length).toBe(5);               // the match set is never empty
      for (const r of rows.rows as any[]) expect(r.organization_id).toBe(ORG_A);
    });
  });

  it('a cross-tenant composition is refused at the ATTEMPT boundary (G-6 closed)', async () => {
    await inRollback(async () => {
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      // TRIPWIRE: if the provider is reached, that is the failure.
      fetchMock.mockImplementation(async () => {
        throw new Error('G-6 VIOLATION: the provider was reached on a cross-tenant attempt');
      });

      let threw: unknown = null;
      try { await runLeased(ORG_A, accB); } catch (e) { threw = e; }

      // ── WHAT CHANGED ────────────────────────────────────────────────────────
      // This test previously PINNED the defect: an attempt row WAS written, and
      // the provider HAD been called, before the evidence layer refused. The
      // migration `20261120000000_pi_attempt_ledger_tenant_fk` made the attempt
      // ledger tenant-coupled, so the refusal now happens at the first write.
      //
      // The flip is deliberate: the G-3 report recorded this pin precisely so a
      // later fix would invert it rather than discover it.
      expect(String(threw)).toMatch(/23503|foreign key/i);
      expect(fetchMock).not.toHaveBeenCalled();         // never reached
      expect(await attemptsFor(accB)).toHaveLength(0);  // was 1

      // Everything downstream remains clean, as it already did.
      expect(await assertionsFor(accB)).toHaveLength(0);
      expect(await countOf(accB)).toBeNull();
      expect(await decisionsFor(accB)).toHaveLength(0);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_records WHERE organization_id=$1`, [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('the attempt ledger now carries the composite tenant FKs the rest of the chain has (G-6 closed)', async () => {
    const { rows } = await db.query(`
      SELECT s.relname AS table_name,
             count(*) FILTER (WHERE array_length(con.conkey, 1) = 2)::int AS composite_tenant_fks
        FROM pg_constraint con JOIN pg_class s ON s.oid = con.conrelid
       WHERE con.contype = 'f'
         AND s.relname IN ('source_records', 'source_assertions',
                           'canonical_attribute_decisions', 'prospect_enrichment_attempts')
       GROUP BY s.relname ORDER BY s.relname`);
    const byTable = Object.fromEntries(
      (rows as Array<{ table_name: string; composite_tenant_fks: number }>)
        .map((r) => [r.table_name, Number(r.composite_tenant_fks)]));
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
    expect(byTable.prospect_enrichment_attempts).toBe(2);     // was 0 — G-6 closed
  });

  it('the live lease index is tenant-scoped, so two tenants never contend', async () => {
    await inRollback(async () => {
      const accA = await newAccount(ORG_A, { domain: 'example.com' });
      const accB = await newAccount(ORG_B, { domain: 'example.com' });
      const now = new Date().toISOString();
      const until = new Date(Date.now() + 60_000).toISOString();
      for (const [org, acc] of [[ORG_A, accA], [ORG_B, accB]] as const) {
        const claimed = await claimEnrichmentWork({
          organizationId: org, subject: 'account', entityId: acc, providerId: 'apollo',
          requestedAttributes: ['employee_count'], correlationId: 'c',
          attemptNumber: 1, startedAt: now, claimedBy: 'w', claimedUntil: until,
        });
        expect('attemptId' in claimed).toBe(true);     // neither blocks the other
      }
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.prospect_enrichment_attempts WHERE completed_at IS NULL`);
      expect(rows[0].n).toBe(2);
    });
  });
});
