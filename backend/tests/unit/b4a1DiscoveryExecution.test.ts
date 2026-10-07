/**
 * B4-A1 — the discovery execution architecture.
 *
 * WHAT THESE TESTS DO AND DO NOT PROVE. They exercise the ORCHESTRATION: the
 * order of refusals, search canonicalisation and identity, the bounded loop, the
 * pre-transport marker, the lease, and the handoff into the existing ingestion
 * orchestrator. The provider is SYNTHETIC throughout.
 *
 * They prove NOTHING about Apollo. No Apollo adapter exists, none is registered,
 * no Apollo endpoint is contacted, and a synthetic page is not evidence of a
 * provider's behaviour. The one empirical Apollo capability test is a separate,
 * separately authorized gate.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  canonicalizeSearchCriteria,
  computeSearchDigest,
  validateBounds,
  DISCOVERY_EXECUTION_STATUSES,
  DISCOVERY_BOUND_LIMITS,
  MalformedSearchError,
  OPEN_DISCOVERY_STATUSES,
  isOpenDiscoveryStatus,
  type DiscoveryBounds,
  type DiscoveryProviderAdapter,
} from '../../services/prospectDiscovery/contract';
import { PROVIDER_CALL_STATES } from '../../services/enrichment/attempts';
import {
  createDiscoveryExecution,
  runDiscoveryExecution,
  type DiscoveryPorts,
} from '../../services/prospectDiscovery/discoveryExecutor';
import {
  registerDiscoveryProvider,
  getDiscoveryProvider,
  hasDiscoveryProvider,
  listDiscoveryProviders,
  __resetDiscoveryProviderRegistry,
  DiscoveryProviderRegistrationError,
  UnregisteredDiscoveryProviderError,
} from '../../services/prospectDiscovery/providerRegistry';
import { makeTenantCredentialPort } from '../../services/enrichment/providers/credentials';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const BOUNDS: DiscoveryBounds = { maxPages: 3, maxResults: 10, maxProviderCalls: 3 };

// ───────────────────────────────────────────────────────────────────────────
// An in-memory ledger that enforces the SAME invariants the migration does:
// one live execution per (tenant, provider, search), and the three bounds. T2
// proves the real database enforces them; this lets the orchestration be tested
// against a ledger that refuses the same things, so a bound test here fails for
// the right reason rather than passing because nothing was checking.
// ───────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;

function makeLedger() {
  const rows: Row[] = [];
  let n = 0;

  const check = (r: Row) => {
    if (r.pages_fetched > r.max_pages) throw new Error('CHECK within_page_bound');
    if (r.results_observed > r.max_results) throw new Error('CHECK within_result_bound');
    if (r.provider_calls_made > r.max_provider_calls) throw new Error('CHECK within_call_bound');
    if (r.results_ingested > r.results_observed) throw new Error('CHECK ingested_within_observed');
    if (r.results_observed > 0 && !['called', 'unknown'].includes(r.provider_call_state)) {
      throw new Error('CHECK results_need_transport');
    }
    const open = OPEN_DISCOVERY_STATUSES.includes(r.execution_status);
    if (open !== (r.completed_at === null)) throw new Error('CHECK open_iff_uncompleted');
  };

  const toRow = (r: Row) => ({
    id: r.id,
    organizationId: r.organization_id,
    providerKey: r.provider_key,
    searchCriteria: r.search_criteria,
    searchDigest: r.search_digest,
    bounds: {
      maxPages: r.max_pages, maxResults: r.max_results, maxProviderCalls: r.max_provider_calls,
    },
    attemptNumber: r.attempt_number,
    correlationId: r.correlation_id,
    executionStatus: r.execution_status,
    providerCallState: r.provider_call_state,
    outcome: r.outcome,
    claimedBy: r.claimed_by,
    claimedUntil: r.claimed_until,
    pagesFetched: r.pages_fetched,
    continuationState: r.continuation_state,
    resultsObserved: r.results_observed,
    resultsIngested: r.results_ingested,
    providerCallsMade: r.provider_calls_made,
    providerRequestId: r.provider_request_id,
    providerCostState: r.provider_cost_state,
    providerCostUnits: r.provider_cost_units,
    detail: r.detail,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    nextRetryAt: r.next_retry_at,
  });

  const find = (o: string, p: string, d: string) =>
    rows.filter((r) => r.organization_id === o && r.provider_key === p && r.search_digest === d);

  const ports: DiscoveryPorts = {
    nextAttemptNumber: async ({ organizationId, providerKey, searchDigest }) =>
      find(organizationId, providerKey, searchDigest)
        .reduce((max, r) => Math.max(max, r.attempt_number), 0) + 1,

    claim: async (input) => {
      const live = find(input.organizationId, input.providerKey, input.searchDigest)
        .filter((r) => r.completed_at === null);
      if (live.length) {
        // The lease is the only way past a live row, exactly as in production.
        const expired = live.filter((r) => r.claimed_until && r.claimed_until < input.now);
        if (expired.length) {
          expired[0].claimed_by = input.claimedBy;
          expired[0].claimed_until = input.claimedUntil;
          expired[0].execution_status = 'claimed';
          return {
            claimed: true, id: expired[0].id,
            attemptNumber: expired[0].attempt_number, reclaimed: true,
          };
        }
        return { claimed: false, reason: 'already_live', activeId: live[0].id };
      }
      const row: Row = {
        id: `exec-${++n}`,
        organization_id: input.organizationId,
        provider_key: input.providerKey,
        search_criteria: input.canonicalFilters,
        search_digest: input.searchDigest,
        max_pages: input.bounds.maxPages,
        max_results: input.bounds.maxResults,
        max_provider_calls: input.bounds.maxProviderCalls,
        attempt_number: input.attemptNumber,
        correlation_id: input.correlationId,
        execution_status: 'pending',
        provider_call_state: 'not_called',
        provider_cost_state: 'unknown',
        provider_cost_units: null,
        outcome: null,
        claimed_by: input.claimedBy ?? null,
        claimed_until: input.claimedUntil ?? null,
        pages_fetched: 0,
        continuation_state: null,
        results_observed: 0,
        results_ingested: 0,
        provider_calls_made: 0,
        provider_request_id: null,
        detail: null,
        started_at: input.startedAt,
        completed_at: null,
        next_retry_at: null,
      };
      check(row);
      rows.push(row);
      return { claimed: true, id: row.id, attemptNumber: row.attempt_number, reclaimed: false };
    },

    getExecution: async ({ organizationId, id }) => {
      // TENANT-SCOPED, like the real read: another tenant's id answers null.
      const r = rows.find((x) => x.organization_id === organizationId && x.id === id);
      return r ? (toRow(r) as any) : null;
    },

    markPending: async ({ organizationId, id }) => {
      const r = rows.find((x) => x.organization_id === organizationId
        && x.id === id && x.completed_at === null);
      if (!r) return false;
      r.provider_call_state = 'unknown';
      r.execution_status = 'provider_running';
      return true;
    },

    recordPage: async (input) => {
      const r = rows.find((x) => x.organization_id === input.organizationId
        && x.id === input.id && x.completed_at === null);
      if (!r) throw new Error('no open row');
      r.provider_call_state = 'called';
      r.pages_fetched = input.pagesFetched;
      r.results_observed = input.resultsObserved;
      r.results_ingested = input.resultsIngested;
      r.provider_calls_made = input.providerCallsMade;
      r.continuation_state = input.continuationState ?? null;
      if (input.providerRequestId !== undefined) r.provider_request_id = input.providerRequestId;
      if (input.providerCostState !== undefined) {
        r.provider_cost_state = input.providerCostState;
        r.provider_cost_units = input.providerCostState === 'unknown'
          ? null : (input.providerCostUnits ?? null);
      }
      check(r);
    },

    complete: async (input) => {
      const r = rows.find((x) => x.organization_id === input.organizationId
        && x.id === input.id && x.completed_at === null);
      if (!r) throw new Error('no open row');
      r.execution_status = input.executionStatus;
      r.provider_call_state = input.providerCallState;
      r.outcome = input.outcome;
      r.detail = input.detail ?? null;
      r.completed_at = input.completedAt;
      r.claimed_by = null;
      r.claimed_until = null;
      if ((input as any).counters) {
        const c = (input as any).counters;
        r.pages_fetched = c.pagesFetched;
        r.results_observed = c.resultsObserved;
        r.results_ingested = c.resultsIngested;
        r.provider_calls_made = c.providerCallsMade;
      }
      check(r);
    },
  };

  return { rows, ports, toRow };
}

/** A synthetic provider. It is not a model of any vendor and claims to be none. */
function syntheticProvider(pages: Array<{ records: Row[]; continuation: unknown | null }>, opts: {
  provider?: string;
  cost?: { state: 'unknown' | 'free' | 'billed'; units?: number | null };
  throwOnCall?: number;
} = {}): DiscoveryProviderAdapter & { calls: number; credentials: string[]; remainings: number[] } {
  let calls = 0;
  const adapter: any = {
    provider: opts.provider ?? 'synthetic',
    label: 'Synthetic discovery provider',
    credentials: [] as string[],
    remainings: [] as number[],
    get calls() { return calls; },
    async discover({ credential, remaining, continuation }: any) {
      adapter.credentials.push(credential);
      adapter.remainings.push(remaining);
      calls += 1;
      if (opts.throwOnCall === calls) throw new Error('synthetic transport failure');
      const index = continuation === null ? 0 : Number(continuation);
      const page = pages[index] ?? { records: [], continuation: null };
      return {
        records: page.records,
        continuation: page.continuation,
        providerRequestId: `syn-req-${calls}`,
        ...(opts.cost ? { cost: opts.cost } : {}),
      };
    },
  };
  return adapter;
}

const okPorts = (over: Partial<DiscoveryPorts> = {}): DiscoveryPorts => ({
  gate: (async () => ({ allowed: true })) as any,
  hasTranslator: () => true,
  hasProvider: () => true,
  credential: { resolveCredential: async () => 'tenant-key' },
  authorizeCost: (async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } })) as any,
  ingest: (async ({ records }: any) => ({
    organizationId: ORG_A, source: 'synthetic',
    total: records.length, succeeded: records.length, failed: 0, outcomes: [],
  })) as any,
  now: () => '2026-10-06T00:00:00.000Z',
  ...over,
});

beforeEach(() => { __resetDiscoveryProviderRegistry(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — search canonicalisation and identity', () => {
  it('key order does not change a search', () => {
    const a = canonicalizeSearchCriteria({ b: 2, a: 1 });
    const b = canonicalizeSearchCriteria({ a: 1, b: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the digest is stable across key order — the live index depends on it', () => {
    const d1 = computeSearchDigest({
      provider: 'synthetic', canonicalFilters: canonicalizeSearchCriteria({ z: 'x', a: ['q', 'p'] }), bounds: BOUNDS,
    });
    const d2 = computeSearchDigest({
      provider: 'synthetic', canonicalFilters: canonicalizeSearchCriteria({ a: ['p', 'q'], z: 'x' }), bounds: BOUNDS,
    });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scalar arrays are sorted and de-duplicated; a set of values has no order', () => {
    expect(canonicalizeSearchCriteria({ a: ['b', 'a', 'b'] })).toEqual({ a: ['a', 'b'] });
  });

  it('arrays OF OBJECTS keep their order — reordering would change the search', () => {
    const out = canonicalizeSearchCriteria({ a: [{ y: 2 }, { x: 1 }] }) as any;
    expect(out.a).toEqual([{ y: 2 }, { x: 1 }]);
  });

  it('a null filter and an absent filter are the SAME search', () => {
    const withNull = canonicalizeSearchCriteria({ a: 1, b: null });
    const without = canonicalizeSearchCriteria({ a: 1 });
    expect(JSON.stringify(withNull)).toBe(JSON.stringify(without));
  });

  it('strings are trimmed and an empty one is dropped', () => {
    expect(canonicalizeSearchCriteria({ a: '  x  ', b: '   ' })).toEqual({ a: 'x' });
  });

  it('a non-finite number is REFUSED, never coerced', () => {
    expect(() => canonicalizeSearchCriteria({ a: Number.NaN })).toThrow(MalformedSearchError);
    expect(() => canonicalizeSearchCriteria({ a: Number.POSITIVE_INFINITY })).toThrow(MalformedSearchError);
  });

  it('an empty search is refused — "everything" is not a bounded search', () => {
    expect(() => canonicalizeSearchCriteria({})).toThrow(/at least one filter/);
    expect(() => canonicalizeSearchCriteria({ a: null })).toThrow(/at least one filter/);
  });

  it('a non-object, an over-deep and an over-large search are all refused', () => {
    expect(() => canonicalizeSearchCriteria([1, 2])).toThrow(MalformedSearchError);
    expect(() => canonicalizeSearchCriteria('x')).toThrow(MalformedSearchError);
    let deep: any = 'leaf';
    for (let i = 0; i < 9; i += 1) deep = { n: deep };
    expect(() => canonicalizeSearchCriteria(deep)).toThrow(/nest deeper/);
    expect(() => canonicalizeSearchCriteria({ a: 'x'.repeat(9000) })).toThrow(/exceeds/);
  });

  it('the BOUNDS are part of identity: the same filters over more pages is another search', () => {
    const filters = canonicalizeSearchCriteria({ a: 1 });
    const small = computeSearchDigest({ provider: 'synthetic', canonicalFilters: filters, bounds: BOUNDS });
    const large = computeSearchDigest({
      provider: 'synthetic', canonicalFilters: filters, bounds: { ...BOUNDS, maxPages: 2 },
    });
    expect(small).not.toBe(large);
  });

  it('the provider is part of identity', () => {
    const filters = canonicalizeSearchCriteria({ a: 1 });
    expect(computeSearchDigest({ provider: 'p1', canonicalFilters: filters, bounds: BOUNDS }))
      .not.toBe(computeSearchDigest({ provider: 'p2', canonicalFilters: filters, bounds: BOUNDS }));
  });

  it('bounds must be positive integers within the platform caps', () => {
    expect(validateBounds(BOUNDS)).toEqual(BOUNDS);
    expect(() => validateBounds({ ...BOUNDS, maxPages: 0 })).toThrow(/positive integer/);
    expect(() => validateBounds({ ...BOUNDS, maxResults: 1.5 })).toThrow(/positive integer/);
    expect(() => validateBounds({ ...BOUNDS, maxPages: DISCOVERY_BOUND_LIMITS.maxPages + 1 }))
      .toThrow(/platform limit/);
    expect(() => validateBounds({})).toThrow(/positive integer/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the vocabularies', () => {
  it('the transport truth is the enrichment ledger\'s, not a second copy', () => {
    // Two spellings of one three-valued truth would eventually disagree about
    // the only question that stops a tenant being billed twice.
    expect([...PROVIDER_CALL_STATES]).toEqual(['not_called', 'called', 'unknown']);
  });

  it('open statuses are exactly the three that occupy the live slot', () => {
    expect([...OPEN_DISCOVERY_STATUSES]).toEqual(['pending', 'claimed', 'provider_running']);
    for (const s of DISCOVERY_EXECUTION_STATUSES) {
      expect(isOpenDiscoveryStatus(s)).toBe(OPEN_DISCOVERY_STATUSES.includes(s));
    }
  });

  it('there is no `ambiguous` status — that state is (closed, unknown)', () => {
    expect(DISCOVERY_EXECUTION_STATUSES).not.toContain('ambiguous');
    expect(DISCOVERY_EXECUTION_STATUSES).toContain('refused_pre_call');
  });

  it('the discovery vocabulary names NO canonical attribute and NO provider', () => {
    const src = readFileSync(
      join(__dirname, '../../services/prospectDiscovery/contract.ts'), 'utf8',
    );
    // An Apollo field name here would make the generic contract provider-specific,
    // which is one of the gate's explicit stop conditions.
    expect(src).not.toMatch(/mixed_people|organizations\/enrich|apollo\.io/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the provider registry ships empty', () => {
  it('nothing is registered, so no provider can be reached', () => {
    expect(listDiscoveryProviders()).toEqual([]);
    expect(hasDiscoveryProvider('apollo')).toBe(false);
    expect(() => getDiscoveryProvider('apollo')).toThrow(UnregisteredDiscoveryProviderError);
  });

  it('a duplicate registration is refused rather than silently replacing', () => {
    registerDiscoveryProvider(syntheticProvider([]));
    expect(() => registerDiscoveryProvider(syntheticProvider([])))
      .toThrow(DiscoveryProviderRegistrationError);
  });

  it('an adapter without discover(), or without a key, is refused', () => {
    expect(() => registerDiscoveryProvider({ provider: 'x', label: 'x' } as any))
      .toThrow(/must implement discover/);
    expect(() => registerDiscoveryProvider({ provider: '  ', label: 'x', discover: async () => null } as any))
      .toThrow(/non-empty key/);
  });

  it('NO Apollo discovery adapter exists anywhere in the repository', () => {
    const dir = join(__dirname, '../../services/prospectDiscovery');
    const names = require('fs').readdirSync(dir) as string[];
    expect(names.some((n) => /apollo/i.test(n))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — createDiscoveryExecution: refusal order', () => {
  it('a malformed search writes NOTHING', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: {}, bounds: BOUNDS, correlationId: 'c' },
      okPorts(l.ports),
    );
    expect(r).toMatchObject({ created: false, refusal: 'malformed_search' });
    expect(l.rows).toHaveLength(0);
  });

  it('a disabled tenant writes NOTHING — paying for records with nowhere to go', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, gate: (async () => ({ allowed: false, reason: 'flag_off' })) as any }),
    );
    expect(r).toMatchObject({ created: false, refusal: 'ingestion_disabled' });
    expect(l.rows).toHaveLength(0);
  });

  it('a missing TENANT credential is recorded as refused_pre_call, not_called', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, credential: { resolveCredential: async () => null } }),
    ) as any;
    expect(r.created).toBe(true);
    expect(r.readyForProviderExecution).toBe(false);
    expect(r.refusal).toBe('credential_missing');
    expect(l.rows[0].execution_status).toBe('refused_pre_call');
    expect(l.rows[0].provider_call_state).toBe('not_called');
    expect(l.rows[0].provider_calls_made).toBe(0);
    expect(l.rows[0].completed_at).not.toBeNull();
  });

  it('an unregistered provider is recorded as refused_pre_call', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, hasProvider: () => false }),
    ) as any;
    expect(r.refusal).toBe('provider_not_registered');
    expect(l.rows[0].provider_call_state).toBe('not_called');
  });

  it('a provider with no TRANSLATOR is refused — fetching with nowhere to put it', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, hasTranslator: () => false }),
    ) as any;
    expect(r.refusal).toBe('provider_not_registered');
    expect(r.readyForProviderExecution).toBe(false);
  });

  it('a ready search is left PENDING and nothing is contacted', async () => {
    const l = makeLedger();
    const adapter = syntheticProvider([{ records: [{ id: 'p1' }], continuation: null }]);
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, getProvider: () => adapter as any }),
    ) as any;
    expect(r.readyForProviderExecution).toBe(true);
    expect(r.refusal).toBeNull();
    expect(l.rows[0].execution_status).toBe('pending');
    // THE POINT OF THIS GATE: creating a search contacts nobody.
    expect(adapter.calls).toBe(0);
    expect(l.rows[0].provider_calls_made).toBe(0);
  });

  it('the credential VALUE never appears in the result', async () => {
    const l = makeLedger();
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, credential: { resolveCredential: async () => 'SECRET-KEY-VALUE' } }),
    );
    expect(JSON.stringify(r)).not.toContain('SECRET-KEY-VALUE');
    expect(JSON.stringify(l.rows)).not.toContain('SECRET-KEY-VALUE');
  });

  it('a tenant-less call is refused outright', async () => {
    await expect(createDiscoveryExecution(
      { organizationId: '  ', provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts(),
    )).rejects.toThrow(/never tenant-less/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — duplicate execution, replay and the lease', () => {
  const req = (organizationId = ORG_A) => ({
    organizationId, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c',
  });

  it('a second identical search while the first is LIVE is refused, and names the holder', async () => {
    const l = makeLedger();
    const first = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    const second = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    expect(second.created).toBe(false);
    expect(second.refusal).toBe('already_live');
    expect(second.activeExecutionId).toBe(first.executionId);
    expect(l.rows).toHaveLength(1);
  });

  it('the same search is permitted AGAIN once the first is closed, as attempt 2', async () => {
    const l = makeLedger();
    const first = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    await l.ports.complete!({
      organizationId: ORG_A, id: first.executionId, executionStatus: 'completed',
      providerCallState: 'not_called', outcome: 'no_results', completedAt: '2026-10-06T01:00:00.000Z',
    });
    const second = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    expect(second.created).toBe(true);
    expect(second.attemptNumber).toBe(2);
    expect(l.rows).toHaveLength(2);
  });

  it('a DIFFERENT tenant running the same search is unaffected', async () => {
    const l = makeLedger();
    await createDiscoveryExecution(req(ORG_A), okPorts(l.ports));
    const b = await createDiscoveryExecution(req(ORG_B), okPorts(l.ports)) as any;
    expect(b.created).toBe(true);
    // Same search identity, two tenants, two executions — isolation is by the
    // organization_id leg of the index, not by the digest.
    expect(l.rows[0].search_digest).toBe(l.rows[1].search_digest);
    expect(l.rows.map((r) => r.organization_id)).toEqual([ORG_A, ORG_B]);
  });

  it('an EXPIRED lease is reclaimed in place, preserving progress', async () => {
    const l = makeLedger();
    const first = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    // Pretend the previous owner fetched a page and then died.
    await l.ports.recordPage!({
      organizationId: ORG_A, id: first.executionId, pagesFetched: 1,
      resultsObserved: 2, resultsIngested: 2, providerCallsMade: 1, continuationState: '1',
    });
    l.rows[0].claimed_until = '2026-10-05T00:00:00.000Z';   // expired

    const second = await createDiscoveryExecution(req(), okPorts(l.ports)) as any;
    expect(second.created).toBe(true);
    expect(second.executionId).toBe(first.executionId);     // same row, stolen
    expect(l.rows).toHaveLength(1);
    // Reclaim moves OWNERSHIP, never the progress already paid for.
    expect(l.rows[0].continuation_state).toBe('1');
    expect(l.rows[0].provider_calls_made).toBe(1);
  });

  it('a different search for the same tenant is NOT blocked', async () => {
    const l = makeLedger();
    await createDiscoveryExecution(req(), okPorts(l.ports));
    const other = await createDiscoveryExecution(
      { ...req(), filters: { a: 2 } }, okPorts(l.ports),
    ) as any;
    expect(other.created).toBe(true);
    expect(l.rows[0].search_digest).not.toBe(l.rows[1].search_digest);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the credential port has no environment fallback', () => {
  const PRIOR = process.env.APOLLO_API_KEY;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.APOLLO_API_KEY;
    else process.env.APOLLO_API_KEY = PRIOR;
  });

  it('a platform key in the environment does NOT rescue a tenant with none', async () => {
    process.env.APOLLO_API_KEY = 'platform-key-must-never-be-used';
    const l = makeLedger();
    // The REAL port, with only its store read injected — so this exercises the
    // port's own logic rather than a stand-in that might behave differently.
    const port = makeTenantCredentialPort({ read: async () => ({}) });
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'apollo', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, credential: port }),
    ) as any;
    expect(r.refusal).toBe('credential_missing');
    expect(JSON.stringify(l.rows)).not.toContain('platform-key-must-never-be-used');
  });

  it('one tenant cannot resolve another tenant\'s credential', async () => {
    const store: Record<string, Record<string, string>> = { [ORG_B]: { api_key: 'B-ONLY' } };
    const port = makeTenantCredentialPort({ read: async (companyId) => (store[companyId] ?? {}) as any });
    expect(await port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' })).toBeNull();
    expect(await port.resolveCredential({ organizationId: ORG_B, providerId: 'apollo' })).toBe('B-ONLY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — runDiscoveryExecution: the fetch → ingest seam', () => {
  const create = async (l: ReturnType<typeof makeLedger>, over: Partial<DiscoveryPorts> = {}) => {
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts({ ...l.ports, ...over }),
    ) as any;
    return r.executionId as string;
  };

  it('a page is fetched, handed to the EXISTING orchestrator, and counted', async () => {
    const l = makeLedger();
    const id = await create(l);
    const adapter = syntheticProvider([{ records: [{ id: 'p1' }, { id: 'p2' }], continuation: null }]);
    const seen: any[] = [];
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports,
        getProvider: () => adapter as any,
        ingest: (async (input: any) => { seen.push(input); return { succeeded: input.records.length }; }) as any,
      }),
    });
    expect(out.status).toBe('completed');
    expect(out.outcome).toBe('discovered');
    expect(out.resultsObserved).toBe(2);
    expect(out.resultsIngested).toBe(2);
    expect(out.stopReason).toBe('provider_exhausted');

    // The handoff is ONE call to the orchestrator every other source uses, with
    // the VERIFIED tenant and the provider key as the source.
    expect(seen).toHaveLength(1);
    expect(seen[0].organizationId).toBe(ORG_A);
    expect(seen[0].source).toBe('synthetic');
    expect(seen[0].records).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('records are passed VERBATIM — the executor normalises nothing', async () => {
    const l = makeLedger();
    const id = await create(l);
    const raw = { weird: { nested: [1, 2] }, Name: 'Keep Me' };
    const adapter = syntheticProvider([{ records: [raw], continuation: null }]);
    let handed: any = null;
    await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports, getProvider: () => adapter as any,
        ingest: (async (i: any) => { handed = i.records[0]; return { succeeded: 1 }; }) as any,
      }),
    });
    expect(handed).toEqual(raw);
  });

  it('the TENANT credential is handed to the adapter and nothing else is', async () => {
    const l = makeLedger();
    const id = await create(l);
    const adapter = syntheticProvider([{ records: [], continuation: null }]);
    await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports, getProvider: () => adapter as any,
        credential: { resolveCredential: async () => 'TENANT-A-KEY' },
      }),
    });
    expect(adapter.credentials).toEqual(['TENANT-A-KEY']);
  });

  it('the pre-transport marker is written BEFORE the provider is contacted', async () => {
    const l = makeLedger();
    const id = await create(l);
    const order: string[] = [];
    const adapter = syntheticProvider([{ records: [], continuation: null }]);
    await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports,
        markPending: async (i) => { order.push('mark'); return l.ports.markPending!(i); },
        getProvider: () => ({
          ...adapter,
          discover: async (x: any) => { order.push('discover'); return adapter.discover(x); },
        }) as any,
      }),
    });
    expect(order).toEqual(['mark', 'discover']);
  });

  it('if the marker cannot be persisted the provider is NOT contacted', async () => {
    const l = makeLedger();
    const id = await create(l);
    const adapter = syntheticProvider([{ records: [{ id: 'x' }], continuation: null }]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any, markPending: async () => false }),
    });
    expect(out.status).toBe('failed');
    expect(out.stopReason).toBe('marker_failed');
    expect(adapter.calls).toBe(0);
  });

  it('a transport failure closes as UNKNOWN, never as not_called', async () => {
    const l = makeLedger();
    const id = await create(l);
    const adapter = syntheticProvider([{ records: [], continuation: null }], { throwOnCall: 1 });
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any }),
    });
    expect(out.status).toBe('failed');
    expect(out.stopReason).toBe('provider_failed');
    // The call may have reached the provider and may have been billed. Claiming
    // `not_called` would invite a retry to pay for it twice.
    expect(l.rows[0].provider_call_state).toBe('unknown');
    expect(l.rows[0].provider_calls_made).toBe(1);
  });

  it('an empty result is `no_results`, never a successful `discovered`', async () => {
    const l = makeLedger();
    const id = await create(l);
    const adapter = syntheticProvider([{ records: [], continuation: null }]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any }),
    });
    expect(out.outcome).toBe('no_results');
    expect(out.resultsObserved).toBe(0);
  });

  it('another tenant cannot run this execution', async () => {
    const l = makeLedger();
    const id = await create(l);
    await expect(runDiscoveryExecution({
      organizationId: ORG_B, executionId: id, ports: okPorts(l.ports),
    })).rejects.toThrow(/not found for this tenant/);
  });

  it('a CLOSED execution cannot be run again', async () => {
    const l = makeLedger();
    const id = await create(l);
    await l.ports.complete!({
      organizationId: ORG_A, id, executionStatus: 'cancelled',
      providerCallState: 'not_called', outcome: 'cancelled', completedAt: '2026-10-06T02:00:00.000Z',
    });
    await expect(runDiscoveryExecution({
      organizationId: ORG_A, executionId: id, ports: okPorts(l.ports),
    })).rejects.toThrow(/already closed \(cancelled\)/);
  });

  it('cancellation frees the live slot without pretending anything was fetched', async () => {
    const l = makeLedger();
    const id = await create(l);
    await l.ports.complete!({
      organizationId: ORG_A, id, executionStatus: 'cancelled',
      providerCallState: 'not_called', outcome: 'cancelled', completedAt: '2026-10-06T02:00:00.000Z',
    });
    expect(l.rows[0].provider_calls_made).toBe(0);
    expect(l.rows[0].results_observed).toBe(0);
    // The slot is free, so the tenant may start the search again.
    const again = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts(l.ports),
    ) as any;
    expect(again.created).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the bounds actually bind', () => {
  const createWith = async (l: ReturnType<typeof makeLedger>, bounds: DiscoveryBounds) => {
    const r = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds, correlationId: 'c' },
      okPorts(l.ports),
    ) as any;
    return r.executionId as string;
  };

  it('maxPages stops the loop even when the provider offers more', async () => {
    const l = makeLedger();
    const bounds = { maxPages: 2, maxResults: 100, maxProviderCalls: 9 };
    const id = await createWith(l, bounds);
    // Every page claims there is another, forever.
    const adapter = syntheticProvider([
      { records: [{ id: 'a' }], continuation: '1' },
      { records: [{ id: 'b' }], continuation: '2' },
      { records: [{ id: 'c' }], continuation: '3' },
      { records: [{ id: 'd' }], continuation: '4' },
    ]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any }),
    });
    expect(out.pagesFetched).toBe(2);
    expect(out.stopReason).toBe('max_pages');
    expect(adapter.calls).toBe(2);
  });

  it('maxResults truncates a page larger than the remaining budget', async () => {
    const l = makeLedger();
    const id = await createWith(l, { maxPages: 5, maxResults: 3, maxProviderCalls: 5 });
    const adapter = syntheticProvider([
      { records: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }], continuation: '1' },
    ]);
    let handedCount = 0;
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports, getProvider: () => adapter as any,
        ingest: (async (i: any) => { handedCount = i.records.length; return { succeeded: i.records.length }; }) as any,
      }),
    });
    expect(out.resultsObserved).toBe(3);
    // Only the budgeted records are ingested — the ceiling is real, not advisory.
    expect(handedCount).toBe(3);
    expect(out.stopReason).toBe('max_results');
    // The adapter was told how many were still wanted.
    expect(adapter.remainings[0]).toBe(3);
  });

  it('maxProviderCalls is the COST ceiling and stops the loop', async () => {
    const l = makeLedger();
    const id = await createWith(l, { maxPages: 9, maxResults: 100, maxProviderCalls: 1 });
    const adapter = syntheticProvider([
      { records: [{ id: 'a' }], continuation: '1' },
      { records: [{ id: 'b' }], continuation: '2' },
    ]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any }),
    });
    expect(adapter.calls).toBe(1);
    expect(out.stopReason).toBe('max_provider_calls');
  });

  it('cost governance can decline before any transport', async () => {
    const l = makeLedger();
    const id = await createWith(l, BOUNDS);
    const adapter = syntheticProvider([{ records: [{ id: 'a' }], continuation: null }]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({
        ...l.ports, getProvider: () => adapter as any,
        authorizeCost: (async () => ({ authorized: false, reason: 'daily ceiling reached' })) as any,
      }),
    });
    expect(out.status).toBe('refused_pre_call');
    expect(out.outcome).toBe('cost_denied');
    expect(adapter.calls).toBe(0);
  });

  it('an execution whose budget is already spent closes WITHOUT claiming a call', async () => {
    const l = makeLedger();
    const id = await createWith(l, { maxPages: 1, maxResults: 5, maxProviderCalls: 1 });
    // Simulate a reclaimed row whose previous owner spent the whole ceiling.
    await l.ports.recordPage!({
      organizationId: ORG_A, id, pagesFetched: 1, resultsObserved: 5,
      resultsIngested: 5, providerCallsMade: 1, continuationState: '1',
    });
    const adapter = syntheticProvider([{ records: [{ id: 'z' }], continuation: null }]);
    const out = await runDiscoveryExecution({
      organizationId: ORG_A, executionId: id,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any, now: () => '2026-10-06T03:00:00.000Z' }),
    });
    expect(adapter.calls).toBe(0);
    expect(out.status).toBe('refused_pre_call');
    expect(out.outcome).toBe('bounds_exhausted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — cost evidence is never fabricated', () => {
  it('a provider that states nothing leaves the cost UNKNOWN', async () => {
    const l = makeLedger();
    const created = await createDiscoveryExecution(
      { organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 }, bounds: BOUNDS, correlationId: 'c' },
      okPorts(l.ports),
    ) as any;
    const adapter = syntheticProvider([{ records: [{ id: 'a' }], continuation: null }]);
    await runDiscoveryExecution({
      organizationId: ORG_A, executionId: created.executionId,
      ports: okPorts({ ...l.ports, getProvider: () => adapter as any }),
    });
    // NOT `free`. D22-B4-A left the provider's billing behaviour unverified, and
    // optimising silence into "free" is the fabrication the gate forbids.
    expect(l.rows[0].provider_cost_state).toBe('unknown');
    expect(l.rows[0].provider_cost_units).toBeNull();
  });

  it('a later page cannot DOWNGRADE a stated cost back to unknown', async () => {
    const l = makeLedger();
    const created = await createDiscoveryExecution(
      {
        organizationId: ORG_A, provider: 'synthetic', filters: { a: 1 },
        bounds: { maxPages: 2, maxResults: 50, maxProviderCalls: 2 }, correlationId: 'c',
      },
      okPorts(l.ports),
    ) as any;
    // Page 1 says `billed`; page 2 says nothing at all.
    let call = 0;
    const adapter: any = {
      provider: 'synthetic', label: 's',
      async discover() {
        call += 1;
        return call === 1
          ? { records: [{ id: 'a' }], continuation: '1', cost: { state: 'billed', units: 1 } }
          : { records: [{ id: 'b' }], continuation: null };
      },
    };
    await runDiscoveryExecution({
      organizationId: ORG_A, executionId: created.executionId,
      ports: okPorts({ ...l.ports, getProvider: () => adapter }),
    });
    expect(l.rows[0].provider_cost_state).toBe('billed');
    expect(l.rows[0].provider_cost_units).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the layer writes no canonical data and performs no egress', () => {
  const read = (f: string) =>
    readFileSync(join(__dirname, '../../services/prospectDiscovery', f), 'utf8');

  it('the executor imports NO http client — all egress belongs to an adapter', () => {
    const src = read('discoveryExecutor.ts');
    expect(src).not.toMatch(/from '.*safeFetch'|require\(.*safeFetch|\bfetch\(|axios|node-fetch|https?\.request/);
  });

  it('the executor writes NO table of its own', () => {
    // It must reach the database only through the discovery ledger store, and
    // the canonical spine only through the ingestion orchestrator.
    expect(read('discoveryExecutor.ts')).not.toMatch(/ownedDbTable|supabase\.from|from '.*supabaseClient'/);
  });

  it('nothing in the layer writes a canonical prospect table directly', () => {
    for (const f of ['contract.ts', 'discoveryExecutor.ts', 'discoveryAttemptStore.ts', 'providerRegistry.ts']) {
      const src = read(f);
      for (const table of [
        'canonical_leads', 'unified_persons', 'prospect_accounts',
        'source_records', 'source_assertions', 'canonical_attribute_decisions',
      ]) {
        // A direct write to any of these would be a second path into the
        // canonical spine, bypassing identity resolution and B1b.
        expect(src.includes(`ownedDbTable('${table}')`)).toBe(false);
        expect(src.includes(`from('${table}')`)).toBe(false);
      }
    }
  });

  it('the store writes ONLY prospect_discovery_attempts', () => {
    const src = read('discoveryAttemptStore.ts');
    const tables = [...src.matchAll(/ownedDbTable\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)]).toEqual(['prospect_discovery_attempts']);
  });

  it('the layer does not touch the FROZEN enrichment ledger', () => {
    for (const f of ['contract.ts', 'discoveryExecutor.ts', 'discoveryAttemptStore.ts']) {
      expect(read(f)).not.toMatch(/ownedDbTable\('prospect_enrichment_attempts'\)/);
    }
  });

  it('completing an execution demands a TERMINAL status', async () => {
    const { completeDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryAttemptStore');
    await expect(completeDiscoveryExecution({
      organizationId: ORG_A, id: 'x', executionStatus: 'pending',
      providerCallState: 'not_called', outcome: null, completedAt: '2026-10-06T00:00:00.000Z',
    })).rejects.toThrow(/requires a terminal status/);
  });

  it('the store refuses a digest that is not a sha256', async () => {
    const { findLiveDiscoveryExecution } = require('../../services/prospectDiscovery/discoveryAttemptStore');
    await expect(findLiveDiscoveryExecution({
      organizationId: ORG_A, providerKey: 'synthetic', searchDigest: 'not-a-digest',
    })).rejects.toThrow(/lowercase sha256/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A1 — the route records a search and cannot call a provider', () => {
  const src = readFileSync(
    join(__dirname, '../../../pages/api/prospect-sources/discovery.ts'), 'utf8',
  );

  it('it invokes the tenant and capability guards', () => {
    expect(src).toMatch(/enforceCompanyAccess\(\{ req, res, companyId \}\)/);
    expect(src).toMatch(/requireCapability\(/);
    expect(src).toMatch(/capability: PROSPECT_INGEST/);
  });

  it('the kill switch is checked BEFORE any membership lookup', () => {
    // CALL sites, not the import list: the import of `enforceCompanyAccess` is at
    // the top of the file and comparing against it would pass for any ordering.
    expect(src.indexOf('if (!isLeadIngestionEnabled())'))
      .toBeLessThan(src.indexOf('await enforceCompanyAccess('));
  });

  it('the tenant comes from the QUERY, never from the body', () => {
    expect(src).toMatch(/req\.query\.company_id/);
    expect(src).not.toMatch(/body\.company_id|body\.companyId/);
  });

  it('it is wrapped in the existing idempotency middleware for POST', () => {
    expect(src).toMatch(/withIdempotency\(handler, \{[\s\S]*methods: \['POST'\]/);
  });

  it('it never invokes the provider stage', () => {
    // The structural guarantee: provider invocation is a separately gated step,
    // so the route's module does not even import the function that performs it.
    expect(src).toMatch(/import \{ createDiscoveryExecution \}/);
    // Neither IMPORTED nor CALLED. Matched as import and call forms rather than
    // as a bare name, because the header explains why the provider stage is kept
    // out of this route and that prose must not satisfy the assertion.
    expect(src).not.toMatch(/import[^;]*\brunDiscoveryExecution\b/);
    expect(src).not.toMatch(/\brunDiscoveryExecution\s*\(/);
    expect(src).not.toMatch(/\b(getDiscoveryProvider|registerDiscoveryProvider)\s*\(/);
  });

  it('it names no provider, so it cannot be an Apollo endpoint in disguise', () => {
    expect(src).not.toMatch(/apollo\.io|mixed_people|APOLLO_API_KEY/i);
  });
});
