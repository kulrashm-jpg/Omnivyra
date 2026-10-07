/**
 * B4-A1 — the discovery execution ledger, against the real schema.
 *
 * WHAT IS REAL HERE: the table, every CHECK, both unique indexes, the lease, the
 * store module, the executor's orchestration, and the handoff contract. The
 * PROVIDER is synthetic and the ingestion orchestrator is stubbed at its own
 * boundary, so this suite proves the seam — not any vendor's behaviour.
 *
 * NO APOLLO CALL HAPPENS, and none could: there is no Apollo discovery adapter in
 * the repository, the discovery registry ships empty, and `safeFetch` is mocked
 * as a TRIPWIRE so any accidental egress fails loudly rather than passing on a
 * technicality.
 *
 * The pg adapter below is the same `writeOwner` translation the other real-schema
 * PI suites use: a SAVEPOINT per statement so a refused write leaves the
 * surrounding transaction usable, and Date→ISO on the way out because `pg`
 * returns `timestamptz` as a `Date` while the production client returns a string.
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(() => {
    throw new Error('B4-A1 VIOLATION: the network was reached in an architecture-only gate');
  }),
}));

/**
 * The DEFAULT credential port is replaced with one that throws.
 *
 * Two reasons, both deliberate. It must never be reached — every test supplies
 * its own `credential` port, and a silent fall-through to the real encrypted
 * store would be a test reading production-shaped configuration. And the real
 * module reaches `@/config` through the credential-encryption chain, which the
 * real-schema jest project does not alias; mocking it here keeps that project's
 * configuration untouched rather than widening shared test infrastructure for
 * one suite. T1 exercises the real port's own logic with an injected store read.
 */
jest.mock('../../services/enrichment/providers/credentials', () => ({
  __esModule: true,
  PROVIDER_API_KEY: 'api_key',
  makeTenantCredentialPort: () => {
    throw new Error('the credential port must not be constructed in this suite');
  },
  tenantCredentialPort: {
    resolveCredential: async () => {
      throw new Error('B4-A1: the DEFAULT credential port was reached — ports are supplied explicitly');
    },
  },
}));

import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, constraintDef, uniqueIndexColumns,
} from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter =
      | { kind: 'eq' | 'is' | 'lt'; col: string; val: unknown }
      | { kind: 'in'; col: string; val: unknown[] };
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
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.kind === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.kind === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
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
        (Array.isArray(v) ? JSON.stringify(v) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
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
      eq: (col: string, val: unknown) => { st.filters.push({ kind: 'eq', col, val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ kind: 'is', col, val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ kind: 'in', col, val }); return b; },
      lt: (col: string, val: unknown) => { st.filters.push({ kind: 'lt', col, val }); return b; },
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
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const store = require('../../services/prospectDiscovery/discoveryAttemptStore');
const {
  createDiscoveryExecution, runDiscoveryExecution,
} = require('../../services/prospectDiscovery/discoveryExecutor');
const {
  canonicalizeSearchCriteria, computeSearchDigest,
} = require('../../services/prospectDiscovery/contract');
const {
  listDiscoveryProviders, hasDiscoveryProvider,
} = require('../../services/prospectDiscovery/providerRegistry');
/* eslint-enable @typescript-eslint/no-var-requires */

const T = 'public.prospect_discovery_attempts';
const BOUNDS = { maxPages: 3, maxResults: 10, maxProviderCalls: 3 };
const NOW = '2026-10-06T00:00:00.000Z';
const FILTERS = canonicalizeSearchCriteria({ segment: 'alpha', size: [2, 1] });
const DIGEST = computeSearchDigest({ provider: 'synthetic', canonicalFilters: FILTERS, bounds: BOUNDS });

/** Insert a row directly, naming every column the CHECKs care about. */
async function rawInsert(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    organization_id: ORG_A,
    provider_key: 'synthetic',
    search_criteria: JSON.stringify(FILTERS),
    search_digest: DIGEST,
    max_pages: BOUNDS.maxPages,
    max_results: BOUNDS.maxResults,
    max_provider_calls: BOUNDS.maxProviderCalls,
    attempt_number: 1,
    correlation_id: 'c-1',
    started_at: NOW,
    ...over,
  };
  const keys = Object.keys(row);
  const { rows } = await db.query(
    `INSERT INTO ${T} (${keys.map((k) => `"${k}"`).join(',')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    keys.map((k) => row[k]),
  );
  return rows[0].id;
}

const okPorts = (over: Record<string, unknown> = {}) => ({
  gate: async () => ({ allowed: true }),
  hasTranslator: () => true,
  hasProvider: () => true,
  credential: { resolveCredential: async () => 'tenant-key' },
  authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
  ingest: async ({ records }: any) => ({ succeeded: records.length, failed: 0 }),
  now: () => NOW,
  ...over,
});

const syntheticProvider = (pages: Array<{ records: any[]; continuation: unknown | null }>) => {
  let calls = 0;
  const a: any = {
    provider: 'synthetic', label: 'Synthetic',
    get calls() { return calls; },
    async discover({ continuation }: any) {
      calls += 1;
      const page = pages[continuation === null ? 0 : Number(continuation)] ?? { records: [], continuation: null };
      return { records: page.records, continuation: page.continuation, providerRequestId: `req-${calls}` };
    },
  };
  return a;
};

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the table exists and the ENRICHMENT ledger is untouched', () => {
  it('prospect_discovery_attempts exists with no person/account subject at all', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_discovery_attempts'`,
    );
    const cols = rows.map((r: any) => r.column_name);
    expect(cols).toContain('search_digest');
    expect(cols).toContain('organization_id');
    // The whole reason this table exists: a discovery attempt has NO canonical subject.
    expect(cols).not.toContain('person_id');
    expect(cols).not.toContain('account_id');
    // And a search has filters, not canonical enrichment attributes.
    expect(cols).not.toContain('requested_attributes');
  });

  it('G-6\'s enrichment invariant is EXACTLY as it was — nothing widened it', async () => {
    const def = await constraintDef('prospect_enrichment_attempts_one_subject');
    expect(def).not.toBeNull();
    expect(def!.replace(/\s+/g, ' ')).toContain('person_id IS NOT NULL');
    expect(def!.replace(/\s+/g, ' ')).toContain('account_id IS NOT NULL');
  });

  it('the enrichment ledger gained no discovery column', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'`,
    );
    const cols = rows.map((r: any) => r.column_name);
    expect(cols).not.toContain('search_digest');
    expect(cols).not.toContain('search_criteria');
  });

  it('the live index is the concurrency arbiter and is PARTIAL on open rows', async () => {
    expect(await uniqueIndexColumns('prospect_discovery_attempts_live'))
      .toEqual(['organization_id', 'provider_key', 'search_digest']);
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND indexname='prospect_discovery_attempts_live'`,
    );
    // PARTIAL is the load-bearing detail: it is what lets a tenant repeat a
    // search later while still refusing two at once.
    expect(rows[0].indexdef).toMatch(/WHERE \(completed_at IS NULL\)/);
  });

  it('attempt-number identity is unique and NOT partial', async () => {
    expect(await uniqueIndexColumns('prospect_discovery_attempts_number_unique'))
      .toEqual(['organization_id', 'provider_key', 'search_digest', 'attempt_number']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the CHECKs refuse what the application must never write', () => {
  it('a row is tenant-scoped: an unknown tenant is refused by the FK', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
         VALUES ('00000000-0000-4000-8000-0000000000ff', 'synthetic', '{}'::jsonb, $1, 1, 1, 1, 1, 'c', $2)`,
        [DIGEST, NOW],
      )).toBe('23503');
    });
  });

  it('a digest that is not a sha256 is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
         VALUES ($1, 'synthetic', '{}'::jsonb, 'nope', 1, 1, 1, 1, 'c', $2)`,
        [ORG_A, NOW],
      )).toBe('23514');
    });
  });

  it('search_criteria must be an OBJECT — an array would make the digest unreproducible', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
         VALUES ($1, 'synthetic', '[1,2]'::jsonb, $2, 1, 1, 1, 1, 'c', $3)`,
        [ORG_A, DIGEST, NOW],
      )).toBe('23514');
    });
  });

  it('an invalid status, call state or cost state is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      expect(await attempt(`UPDATE ${T} SET execution_status='ambiguous' WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET provider_call_state='maybe' WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET provider_cost_state='cheap' WHERE id=$1`, [id])).toBe('23514');
    });
  });

  it('THE BOUNDS BIND IN THE DATABASE, not merely in the application', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      // Transport must be admitted first, or a different CHECK fires.
      await db.query(`UPDATE ${T} SET provider_call_state='called' WHERE id=$1`, [id]);
      expect(await attempt(`UPDATE ${T} SET pages_fetched=$1 WHERE id=$2`,
        [BOUNDS.maxPages + 1, id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET results_observed=$1 WHERE id=$2`,
        [BOUNDS.maxResults + 1, id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET provider_calls_made=$1 WHERE id=$2`,
        [BOUNDS.maxProviderCalls + 1, id])).toBe('23514');
      // And the bounds themselves must be positive.
      expect(await attempt(`UPDATE ${T} SET max_pages=0 WHERE id=$1`, [id])).toBe('23514');
    });
  });

  it('nothing can be ingested that was never observed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      await db.query(
        `UPDATE ${T} SET provider_call_state='called', results_observed=2 WHERE id=$1`, [id],
      );
      expect(await attempt(`UPDATE ${T} SET results_ingested=3 WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET results_ingested=2 WHERE id=$1`, [id])).toBe('ok');
    });
  });

  it('NO PROVIDER RESULT WITHOUT A PROVIDER CALL — the "did we pay?" invariant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      // Results, a call count or a provider request id, while claiming nothing
      // was contacted, would make a bill unattributable.
      expect(await attempt(`UPDATE ${T} SET results_observed=1 WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET provider_calls_made=1 WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE ${T} SET provider_request_id='x' WHERE id=$1`, [id])).toBe('23514');
      // `unknown` is accepted, because a call that died mid-flight may have been billed.
      expect(await attempt(
        `UPDATE ${T} SET provider_call_state='unknown', provider_calls_made=1 WHERE id=$1`, [id],
      )).toBe('ok');
    });
  });

  it('cost units cannot be stated while the cost is claimed UNKNOWN', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      expect(await attempt(`UPDATE ${T} SET provider_cost_units=3 WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(
        `UPDATE ${T} SET provider_cost_state='billed', provider_cost_units=3 WHERE id=$1`, [id],
      )).toBe('ok');
      expect(await attempt(
        `UPDATE ${T} SET provider_cost_state='billed', provider_cost_units=-1 WHERE id=$1`, [id],
      )).toBe('23514');
    });
  });

  it('an OPEN status and a completed_at cannot coexist, in either direction', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      // Closed timestamp while still claiming to be open.
      expect(await attempt(`UPDATE ${T} SET completed_at=$1 WHERE id=$2`, [NOW, id])).toBe('23514');
      // Terminal status with no closing timestamp.
      expect(await attempt(`UPDATE ${T} SET execution_status='completed' WHERE id=$1`, [id])).toBe('23514');
      // Both together is the only accepted shape.
      expect(await attempt(
        `UPDATE ${T} SET execution_status='completed', completed_at=$1 WHERE id=$2`, [NOW, id],
      )).toBe('ok');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — tenant isolation', () => {
  it('two tenants may run the SAME search concurrently; neither blocks the other', async () => {
    await inRollback(async () => {
      await seedTenants();
      await rawInsert({ organization_id: ORG_A });
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
         VALUES ($1, 'synthetic', $2::jsonb, $3, 3, 10, 3, 1, 'c', $4)`,
        [ORG_B, JSON.stringify(FILTERS), DIGEST, NOW],
      )).toBe('ok');
    });
  });

  it('one tenant cannot READ another tenant\'s execution, even knowing its id', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({ organization_id: ORG_B });
      // Tenant-scoped read: the id is real, the tenant is wrong, the answer is null —
      // indistinguishable from an execution that does not exist.
      expect(await store.getDiscoveryExecution({ organizationId: ORG_A, id })).toBeNull();
      expect(await store.getDiscoveryExecution({ organizationId: ORG_B, id })).not.toBeNull();
    });
  });

  it('one tenant cannot CLOSE another tenant\'s execution', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({ organization_id: ORG_B });
      await store.completeDiscoveryExecution({
        organizationId: ORG_A, id, executionStatus: 'cancelled',
        providerCallState: 'not_called', outcome: 'cancelled', completedAt: NOW,
      });
      const { rows } = await db.query(
        `SELECT execution_status, completed_at FROM ${T} WHERE id=$1`, [id],
      );
      // Untouched: the tenant predicate matched nothing, so nothing was written.
      expect(rows[0].execution_status).toBe('pending');
      expect(rows[0].completed_at).toBeNull();
    });
  });

  it('one tenant cannot advance another tenant\'s counters', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({ organization_id: ORG_B });
      await store.recordDiscoveryPage({
        organizationId: ORG_A, id, pagesFetched: 1, resultsObserved: 1,
        resultsIngested: 1, providerCallsMade: 1, continuationState: null,
      });
      const { rows } = await db.query(`SELECT results_observed, provider_calls_made FROM ${T} WHERE id=$1`, [id]);
      expect(Number(rows[0].results_observed)).toBe(0);
      expect(Number(rows[0].provider_calls_made)).toBe(0);
    });
  });

  it('one tenant cannot steal another tenant\'s lease', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({
        organization_id: ORG_B, claimed_by: 'b-worker', claimed_until: '2026-10-05T00:00:00.000Z',
      });
      const stolen = await store.reclaimExpiredDiscoveryExecution({
        organizationId: ORG_A, providerKey: 'synthetic', searchDigest: DIGEST,
        claimedBy: 'a-worker', claimedUntil: '2026-10-06T01:00:00.000Z', now: NOW,
      });
      expect(stolen).toBeNull();
      const { rows } = await db.query(`SELECT claimed_by FROM ${T} WHERE id=$1`, [id]);
      expect(rows[0].claimed_by).toBe('b-worker');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — identity, replay and the lease, against the real index', () => {
  it('a second LIVE execution of one search is refused by the DATABASE', async () => {
    await inRollback(async () => {
      await seedTenants();
      await rawInsert();
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
         VALUES ($1, 'synthetic', $2::jsonb, $3, 3, 10, 3, 2, 'c-2', $4)`,
        [ORG_A, JSON.stringify(FILTERS), DIGEST, NOW],
      )).toBe('23505');
    });
  });

  it('the claim path turns that 23505 into a truthful refusal naming the holder', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await rawInsert({ claimed_until: '2026-10-07T00:00:00.000Z' });
      const claim = await store.claimDiscoveryExecution({
        organizationId: ORG_A, providerKey: 'synthetic', canonicalFilters: FILTERS,
        searchDigest: DIGEST, bounds: BOUNDS, attemptNumber: 2, correlationId: 'c-2',
        startedAt: NOW, claimedBy: 'w2', claimedUntil: '2026-10-06T01:00:00.000Z', now: NOW,
      });
      expect(claim.claimed).toBe(false);
      expect(claim.activeId).toBe(first);
    });
  });

  it('the SAME search runs again as attempt 2 once the first is closed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await rawInsert();
      await db.query(
        `UPDATE ${T} SET execution_status='completed', completed_at=$1 WHERE id=$2`, [NOW, first],
      );
      expect(await store.nextDiscoveryAttemptNumber({
        organizationId: ORG_A, providerKey: 'synthetic', searchDigest: DIGEST,
      })).toBe(2);
      const claim = await store.claimDiscoveryExecution({
        organizationId: ORG_A, providerKey: 'synthetic', canonicalFilters: FILTERS,
        searchDigest: DIGEST, bounds: BOUNDS, attemptNumber: 2, correlationId: 'c-2',
        startedAt: NOW, claimedBy: 'w2', claimedUntil: '2026-10-06T01:00:00.000Z', now: NOW,
      });
      expect(claim.claimed).toBe(true);
      expect(claim.id).not.toBe(first);
    });
  });

  it('attempt-number identity refuses a duplicate attempt in HISTORY', async () => {
    await inRollback(async () => {
      await seedTenants();
      const first = await rawInsert();
      await db.query(`UPDATE ${T} SET execution_status='completed', completed_at=$1 WHERE id=$2`, [NOW, first]);
      // Same attempt number again, both closed, so the live index does not apply —
      // the non-partial index is what refuses it.
      expect(await attempt(
        `INSERT INTO ${T} (organization_id, provider_key, search_criteria, search_digest,
            max_pages, max_results, max_provider_calls, attempt_number, correlation_id,
            started_at, execution_status, completed_at)
         VALUES ($1,'synthetic',$2::jsonb,$3,3,10,3,1,'c',$4,'completed',$4)`,
        [ORG_A, JSON.stringify(FILTERS), DIGEST, NOW],
      )).toBe('23505');
    });
  });

  it('an EXPIRED lease is reclaimed IN PLACE, keeping the continuation', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({
        claimed_by: 'dead-worker', claimed_until: '2026-10-05T00:00:00.000Z',
        provider_call_state: 'called', pages_fetched: 1, results_observed: 2,
        results_ingested: 2, provider_calls_made: 1,
        continuation_state: JSON.stringify({ page: 1 }),
      });
      const stolen = await store.reclaimExpiredDiscoveryExecution({
        organizationId: ORG_A, providerKey: 'synthetic', searchDigest: DIGEST,
        claimedBy: 'new-worker', claimedUntil: '2026-10-06T01:00:00.000Z', now: NOW,
      });
      expect(stolen.id).toBe(id);
      expect(stolen.claimedBy).toBe('new-worker');
      // Reclaim moves OWNERSHIP only. The progress already paid for survives, so
      // the search resumes rather than restarting and paying twice.
      expect(stolen.continuationState).toEqual({ page: 1 });
      expect(stolen.providerCallsMade).toBe(1);
    });
  });

  it('an UNEXPIRED lease is NOT reclaimable', async () => {
    await inRollback(async () => {
      await seedTenants();
      await rawInsert({ claimed_by: 'alive', claimed_until: '2026-10-07T00:00:00.000Z' });
      expect(await store.reclaimExpiredDiscoveryExecution({
        organizationId: ORG_A, providerKey: 'synthetic', searchDigest: DIGEST,
        claimedBy: 'thief', claimedUntil: '2026-10-06T01:00:00.000Z', now: NOW,
      })).toBeNull();
    });
  });

  it('closing an execution RELEASES the lease, so history cannot look in-flight', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert({ claimed_by: 'w', claimed_until: '2026-10-07T00:00:00.000Z' });
      await store.completeDiscoveryExecution({
        organizationId: ORG_A, id, executionStatus: 'completed',
        providerCallState: 'not_called', outcome: 'no_results', completedAt: NOW,
      });
      const { rows } = await db.query(`SELECT claimed_by, claimed_until FROM ${T} WHERE id=$1`, [id]);
      expect(rows[0].claimed_by).toBeNull();
      expect(rows[0].claimed_until).toBeNull();
    });
  });

  it('a credential-shaped detail is REDACTED before it reaches the row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await rawInsert();
      await store.completeDiscoveryExecution({
        organizationId: ORG_A, id, executionStatus: 'failed',
        providerCallState: 'not_called', outcome: null,
        detail: 'provider said x-api-key: super-secret-value',
        completedAt: NOW,
      });
      const { rows } = await db.query(`SELECT detail FROM ${T} WHERE id=$1`, [id]);
      expect(rows[0].detail).not.toContain('super-secret-value');
      expect(rows[0].detail).toContain('[redacted]');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the executor against the real ledger', () => {
  it('creating a search records PENDING and contacts nobody', async () => {
    await inRollback(async () => {
      await seedTenants();
      const adapter = syntheticProvider([{ records: [{ id: 'x' }], continuation: null }]);
      const r = await createDiscoveryExecution(
        {
          organizationId: ORG_A, provider: 'synthetic',
          filters: { segment: 'alpha', size: [2, 1] }, bounds: BOUNDS, correlationId: 'c',
        },
        okPorts({ getProvider: () => adapter }),
      );
      expect(r.created).toBe(true);
      expect(r.readyForProviderExecution).toBe(true);
      expect(r.searchDigest).toBe(DIGEST);
      const { rows } = await db.query(
        `SELECT execution_status, provider_call_state, provider_calls_made FROM ${T} WHERE id=$1`,
        [r.executionId],
      );
      expect(rows[0].execution_status).toBe('pending');
      expect(rows[0].provider_call_state).toBe('not_called');
      expect(Number(rows[0].provider_calls_made)).toBe(0);
      expect(adapter.calls).toBe(0);
    });
  });

  it('a missing tenant credential is recorded as refused_pre_call / not_called', async () => {
    await inRollback(async () => {
      await seedTenants();
      const r = await createDiscoveryExecution(
        {
          organizationId: ORG_A, provider: 'synthetic',
          filters: { segment: 'alpha' }, bounds: BOUNDS, correlationId: 'c',
        },
        okPorts({ credential: { resolveCredential: async () => null } }),
      );
      expect(r.refusal).toBe('credential_missing');
      const { rows } = await db.query(
        `SELECT execution_status, provider_call_state FROM ${T} WHERE id=$1`, [r.executionId],
      );
      expect(rows[0].execution_status).toBe('refused_pre_call');
      expect(rows[0].provider_call_state).toBe('not_called');
    });
  });

  it('a full run fetches, hands records to ingestion, and records the evidence', async () => {
    await inRollback(async () => {
      await seedTenants();
      const adapter = syntheticProvider([
        { records: [{ id: 'a' }, { id: 'b' }], continuation: '1' },
        { records: [{ id: 'c' }], continuation: null },
      ]);
      const created = await createDiscoveryExecution(
        {
          organizationId: ORG_A, provider: 'synthetic',
          filters: { segment: 'alpha', size: [2, 1] }, bounds: BOUNDS, correlationId: 'c',
        },
        okPorts({ getProvider: () => adapter }),
      );
      const handed: any[] = [];
      const out = await runDiscoveryExecution({
        organizationId: ORG_A, executionId: created.executionId,
        ports: okPorts({
          getProvider: () => adapter,
          ingest: async (i: any) => { handed.push(i); return { succeeded: i.records.length }; },
        }),
      });
      expect(out.status).toBe('completed');
      expect(out.resultsObserved).toBe(3);
      expect(out.resultsIngested).toBe(3);

      // The handoff went to the EXISTING orchestrator, once per page, with the
      // verified tenant and the provider key as the source.
      expect(handed.map((h) => h.records.length)).toEqual([2, 1]);
      expect(handed.every((h) => h.organizationId === ORG_A)).toBe(true);
      expect(handed.every((h) => h.source === 'synthetic')).toBe(true);

      const { rows } = await db.query(
        `SELECT execution_status, provider_call_state, pages_fetched, results_observed,
                results_ingested, provider_calls_made, provider_cost_state, provider_request_id
           FROM ${T} WHERE id=$1`, [created.executionId],
      );
      expect(rows[0].execution_status).toBe('completed');
      expect(rows[0].provider_call_state).toBe('called');
      expect(Number(rows[0].pages_fetched)).toBe(2);
      expect(Number(rows[0].results_observed)).toBe(3);
      expect(Number(rows[0].provider_calls_made)).toBe(2);
      expect(rows[0].provider_request_id).toBe('req-2');
      // The provider stated no cost, so the cost stays UNKNOWN. Not `free`.
      expect(rows[0].provider_cost_state).toBe('unknown');
    });
  });

  it('the bound stops the run and the row never exceeds its ceiling', async () => {
    await inRollback(async () => {
      await seedTenants();
      const adapter = syntheticProvider([
        { records: [{ id: '1' }], continuation: '1' },
        { records: [{ id: '2' }], continuation: '2' },
        { records: [{ id: '3' }], continuation: '3' },
      ]);
      const bounds = { maxPages: 2, maxResults: 50, maxProviderCalls: 5 };
      const created = await createDiscoveryExecution(
        {
          organizationId: ORG_A, provider: 'synthetic',
          filters: { segment: 'bounded' }, bounds, correlationId: 'c',
        },
        okPorts({ getProvider: () => adapter }),
      );
      const out = await runDiscoveryExecution({
        organizationId: ORG_A, executionId: created.executionId,
        ports: okPorts({ getProvider: () => adapter }),
      });
      expect(out.stopReason).toBe('max_pages');
      expect(adapter.calls).toBe(2);
      const { rows } = await db.query(`SELECT pages_fetched, max_pages FROM ${T} WHERE id=$1`, [created.executionId]);
      expect(Number(rows[0].pages_fetched)).toBe(2);
      expect(Number(rows[0].pages_fetched)).toBeLessThanOrEqual(Number(rows[0].max_pages));
    });
  });

  it('NO Apollo provider is registered, and no network was reached', async () => {
    expect(listDiscoveryProviders()).toEqual([]);
    expect(hasDiscoveryProvider('apollo')).toBe(false);
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { safeFetch } = require('../../../lib/security/safeFetch');
    /* eslint-enable @typescript-eslint/no-var-requires */
    // The tripwire never fired: this gate is architecture-only.
    expect((safeFetch as jest.Mock).mock.calls).toHaveLength(0);
  });
});
