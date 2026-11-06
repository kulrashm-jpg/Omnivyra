/**
 * PI-LDB - DISCOVERY PROJECTION TRUTH
 *
 * The three `/api/lead-ingestion/*` routes were fixed to report `projected`
 * and `notProjected`. DISCOVERY was not: `runDiscoveryExecution` read only
 * `result.succeeded` from the batch - the counter whose own contract says it
 * "deliberately stays projection-blind" - and then closed the execution as
 * `completed` / `discovered`. A run that fetched records from a vendor,
 * ingested every one of them, and projected NONE of them into
 * `lead_intelligence` was indistinguishable, in the ledger and in the API
 * body, from a run where every lead became visible.
 *
 * These tests drive the PRODUCTION entry point - `createDiscoveryExecution`
 * then `runDiscoveryExecution`, the pair `/api/prospect-sources/discovery`
 * calls - with the real discovery attempt store, the real lead-source
 * registry, the real `ingestLeadBatch`, the real orchestrator, the real
 * `durableLeadIntelligenceSink` and the real `leadIntelligenceRepository` all
 * executing. Only three things are doubled, and each is a boundary outside
 * this process:
 *
 *   `backend/db/writeOwner`  the database. ONE store serves both
 *                            `prospect_discovery_attempts` and
 *                            `lead_intelligence`, so the ledger's claim and
 *                            the read model's contents are observed together.
 *   the tenant credential    a secret, and the cost authorization - money.
 *   the provider adapter     the vendor. Registered through the REAL registry.
 *
 * The identity/account/prospect collaborators are doubled exactly as
 * `piLdbFalsePersistenceGuard.test.ts` doubles them, for the same reason: they
 * are separate database surfaces, and the subject here is the projection.
 *
 * THE OBSERVATION POINT IS NOT A `jest.fn` CALL COUNT. Every assertion is
 * either the returned verdict, the row the ledger actually closed with, or the
 * number of rows that exist in the doubled `lead_intelligence` store - and the
 * invariant test holds the two against each other.
 */

import {
  createDiscoveryExecution,
  runDiscoveryExecution,
  type CreateDiscoveryExecutionResult,
  type DiscoveryPorts,
} from '../../services/prospectDiscovery/discoveryExecutor';
import type { DiscoveryProviderAdapter } from '../../services/prospectDiscovery/contract';
import {
  registerDiscoveryProvider,
  __resetDiscoveryProviderRegistry,
} from '../../services/prospectDiscovery/providerRegistry';
import {
  registerLeadSourceAdapter,
  __resetLeadSourceRegistry,
} from '../../services/leadIngestion/registry';
import type { AdapterResult, LeadSourceAdapter } from '../../services/leadIngestion/contracts';
// Spied on, not replaced: this module is the one AWAIT on the record path
// that is deliberately not wrapped in a try (its own comment says it
// "never fails the record" because the helper reports its own outcome). It
// is therefore the honest place to prove what happens when it does throw.
import * as piContribution from '../../services/prospectProvenance/ingestion/piIngestionContribution';

/* ── the doubled database ─────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string; details?: string | null };
interface DbResult {
  data: unknown;
  error: DbError | null;
  status?: number;
}

const tables = new Map<string, Row[]>();
const tableOf = (name: string): Row[] => {
  const existing = tables.get(name);
  if (existing) return existing;
  const fresh: Row[] = [];
  tables.set(name, fresh);
  return fresh;
};

/** THE PROBE KNOBS: what the `lead_intelligence` upsert does. */
let leadUpsertError: DbError | null = null;
let leadUpsertStatus: number | null = 200;
/** 1-based index of the lead upsert that fails; null = none. */
let failLeadUpsertNth: number | null = null;
let leadUpsertCalls = 0;

type Filter = { kind: 'eq' | 'is' | 'lt'; column: string; value: unknown };

interface Query extends PromiseLike<DbResult> {
  eq(column: string, value: unknown): Query;
  is(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  select(columns?: string): Query;
  single(): Promise<DbResult>;
  maybeSingle(): Promise<DbResult>;
  /**
   * PROMPT 2C. Part of the real postgrest-js builder, which returns itself.
   * The repository turns auto-retry OFF for the score-protection read, so a
   * double that omits this makes that call throw instead of answering.
   */
  retry(enabled: boolean): Query;
}

let idSequence = 0;
const nextId = (prefix: string): string => {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
};

function makeQuery(table: string, op: 'select' | 'insert' | 'update' | 'upsert', payload: Row | null): Query {
  const filters: Filter[] = [];
  let sortColumn: string | null = null;
  let sortAscending = true;
  let rowLimit: number | null = null;

  const matches = (row: Row): boolean => filters.every((f) => {
    if (f.kind === 'eq') return row[f.column] === f.value;
    if (f.kind === 'is') return row[f.column] === f.value || row[f.column] === undefined;
    return String(row[f.column] ?? '') < String(f.value ?? '');
  });

  const resolve = (): DbResult => {
    const store = tableOf(table);

    if (op === 'insert') {
      const row: Row = { id: nextId('row'), ...(payload ?? {}) };
      store.push(row);
      return { data: [row], error: null, status: 201 };
    }

    if (op === 'upsert') {
      if (table === 'lead_intelligence') {
        leadUpsertCalls += 1;
        const forced = leadUpsertError
          ?? (failLeadUpsertNth === leadUpsertCalls
            ? { code: '42501', message: 'row-level security refused this write' }
            : null);
        // NOTHING IS STORED on a refused write. The store's emptiness is what
        // makes a `persisted` verdict here provably false.
        if (forced) return { data: null, error: forced, status: leadUpsertStatus ?? undefined };
      }
      const key = `${String((payload ?? {}).company_id)}|${String((payload ?? {}).dedupe_key)}`;
      const existingIndex = store.findIndex(
        (r) => `${String(r.company_id)}|${String(r.dedupe_key)}` === key,
      );
      if (existingIndex >= 0) {
        const merged: Row = { ...store[existingIndex], ...(payload ?? {}) };
        store[existingIndex] = merged;
        return { data: { id: merged.id }, error: null, status: 200 };
      }
      const row: Row = { id: nextId('lead'), ...(payload ?? {}) };
      store.push(row);
      return { data: { id: row.id }, error: null, status: 201 };
    }

    if (op === 'update') {
      const hit = store.filter(matches);
      for (const row of hit) Object.assign(row, payload ?? {});
      return { data: hit, error: null, status: 200 };
    }

    let rows = store.filter(matches);
    if (sortColumn !== null) {
      const column = sortColumn;
      rows = [...rows].sort((a, b) => {
        const left = Number(a[column] ?? 0);
        const right = Number(b[column] ?? 0);
        return sortAscending ? left - right : right - left;
      });
    }
    if (rowLimit !== null) rows = rows.slice(0, rowLimit);
    return { data: rows, error: null, status: 200 };
  };

  const query: Query = {
    eq(column, value) { filters.push({ kind: 'eq', column, value }); return query; },
    is(column, value) { filters.push({ kind: 'is', column, value }); return query; },
    lt(column, value) { filters.push({ kind: 'lt', column, value }); return query; },
    order(column, options) {
      sortColumn = column;
      sortAscending = options?.ascending !== false;
      return query;
    },
    limit(count) { rowLimit = count; return query; },
    select() { return query; },
    retry() { return query; },
    async single() {
      const result = resolve();
      if (result.error) return result;
      if (Array.isArray(result.data)) {
        if (result.data.length === 1) return { ...result, data: result.data[0] };
        return { data: null, error: { code: 'PGRST116', message: 'expected exactly one row' }, status: 406 };
      }
      return result;
    },
    async maybeSingle() {
      const result = resolve();
      if (result.error) return result;
      if (Array.isArray(result.data)) {
        if (result.data.length === 0) return { ...result, data: null };
        if (result.data.length === 1) return { ...result, data: result.data[0] };
        return { data: null, error: { code: 'PGRST116', message: 'more than one row' }, status: 406 };
      }
      return result;
    },
    then(onfulfilled, onrejected) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };
  return query;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: () => ({ then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }) }),
  ownedDbTable: (table: string) => ({
    insert: (row: Row) => makeQuery(table, 'insert', row),
    upsert: (row: Row) => makeQuery(table, 'upsert', row),
    update: (patch: Row) => makeQuery(table, 'update', patch),
    select: (columns?: string) => makeQuery(table, 'select', null).select(columns),
  }),
}));

/* ── the collaborators, doubled exactly as the false-persistence guard does ── */

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => ({
    sourceRecordId: 'sr-1', outcome: 'created', assertionsRecorded: 1, assertionsAlreadyPresent: 0,
    canonicalApplied: [], canonicalWithheld: [],
  })),
}));
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async (_org: string, input: { email?: string | null }) => ({
    unifiedPersonId: `person-${String(input?.email ?? 'x')}`, matchedBy: 'email', created: false,
  })),
}));
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
  attachPersonToAccount: jest.fn(async () => undefined),
}));
jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async (
    _org: string,
    input: { externalLeadKey?: string | null },
  ) => ({
    organizationId: 'org',
    prospectId: `prospect-${String(input?.externalLeadKey ?? '1')}`,
    subjectId: 'subject-1',
    outcome: 'created',
    externalLeadKey: String(input?.externalLeadKey ?? 'K1'),
    reason: 'created',
  })),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));
jest.mock('../../services/prospectProvenance/ingestion/piIngestionContribution', () => ({
  ...(jest.requireActual('../../services/prospectProvenance/ingestion/piIngestionContribution') as object),
  recordPiIngestionContribution: jest.fn(async () => undefined),
}));
jest.mock('../../services/prospectProvenance/identityReconciliation', () => ({
  reconcileVerifiedPersonIdentities: jest.fn(async () => undefined),
}));

/* ── the vendor and the translator ───────────────────────────────────────── */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const PROVIDER = 'synthdisc';
const NOW = '2026-11-05T00:00:00.000Z';

interface VendorRecord {
  readonly ref: string;
  readonly email: string;
  readonly name: string;
}

const VENDOR_PAGE: VendorRecord[] = [
  { ref: 'V-1', email: 'ada@babbage.example', name: 'Ada Lovelace' },
  { ref: 'V-2', email: 'alan@bletchley.example', name: 'Alan Turing' },
];

/** The pure translator the orchestrator will call. Registered for real. */
const translator: LeadSourceAdapter = {
  source: PROVIDER,
  label: 'Synthetic discovery',
  capabilities: ['person_discovery'],
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult {
    const ref = String(raw.ref ?? '');
    return {
      raw,
      normalized: {
        organizationId,
        source: PROVIDER,
        entityType: 'person',
        externalId: ref,
        person: {
          email: String(raw.email ?? ''),
          fullName: String(raw.name ?? ''),
          jobTitle: 'Procurement Manager',
          externalKeys: { [PROVIDER]: { external_id: ref } },
        },
        observedAt: NOW,
      },
    };
  },
};

const vendor = (records: VendorRecord[]): DiscoveryProviderAdapter => ({
  provider: PROVIDER,
  label: 'Synthetic discovery provider',
  async discover() {
    return { records: records as unknown as Array<Record<string, unknown>>, continuation: null, providerRequestId: 'syn-1' };
  },
});

/**
 * Only the boundaries outside this process. No ledger port, no `ingest` port:
 * the real attempt store and the real orchestrator run.
 */
const externalPorts = (over: Partial<DiscoveryPorts> = {}): DiscoveryPorts => ({
  credential: { resolveCredential: async () => 'tenant-key' },
  authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
  now: () => NOW,
  ...over,
});

const SEARCH = {
  provider: PROVIDER,
  filters: { titles: ['Procurement Manager'] },
  bounds: { maxPages: 1, maxResults: 10, maxProviderCalls: 1 },
};

/** The production pair, in the order `/api/prospect-sources/discovery` calls it. */
async function discover(
  records: VendorRecord[] = VENDOR_PAGE,
  over: Partial<DiscoveryPorts> = {},
  correlationId = 'discovery:test:1',
) {
  __resetDiscoveryProviderRegistry();
  registerDiscoveryProvider(vendor(records));
  const created = await createDiscoveryExecution(
    { organizationId: ORG, correlationId, now: NOW, ...SEARCH },
    externalPorts(over),
  );
  // An explicit cast, not a narrowed union: the root tsconfig sets
  // `strict: false`, which disables narrowing on a boolean discriminant — the
  // same limitation the executor and the route both annotate at their own
  // `!== true` checks.
  if (created.created !== true) {
    throw new Error(`execution was refused: ${(created as { reason?: string }).reason ?? 'unknown'}`);
  }
  const ready = created as Extract<CreateDiscoveryExecutionResult, { created: true }>;
  expect(ready.readyForProviderExecution).toBe(true);
  const run = await runDiscoveryExecution({
    organizationId: ORG,
    executionId: ready.executionId,
    ports: externalPorts(over),
  });
  return { executionId: ready.executionId, run };
}

const leadRows = (): Row[] => tableOf('lead_intelligence');
const ledgerRow = (id: string): Row => {
  const found = tableOf('prospect_discovery_attempts').find((r) => r.id === id);
  if (!found) throw new Error(`no ledger row for ${id}`);
  return found;
};

beforeEach(() => {
  process.env.ENABLE_LEAD_INGESTION = 'true';
  tables.clear();
  idSequence = 0;
  leadUpsertCalls = 0;
  leadUpsertError = null;
  leadUpsertStatus = 200;
  failLeadUpsertNth = null;
  __resetLeadSourceRegistry();
  registerLeadSourceAdapter(translator);
  __resetDiscoveryProviderRegistry();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PI-LDB - discovery does not claim success the read model cannot support', () => {
  it('every projection refused -> `discovered_not_projected`, and NO row exists', async () => {
    // An unapplied migration: `schema_not_applied` is a REASON, and the
    // discovery claim must degrade because of it.
    leadUpsertError = { code: '42P01', message: 'relation "lead_intelligence" does not exist' };

    const { executionId, run } = await discover();

    // The records really were fetched and really did ingest. Nothing here
    // rolls that back - partial durable progress is correct.
    expect(run.resultsObserved).toBe(2);
    expect(run.resultsIngested).toBe(2);

    // THE CLAIM. `discovered` would read downstream as "this search has been
    // answered", and not one lead is listable.
    expect(run.status).toBe('completed');
    expect(run.outcome).toBe('discovered_not_projected');
    expect(run.resultsProjected).toBe(0);
    expect(run.resultsNeedingAttention).toBe(2);

    // THE ROW-EXISTENCE OBSERVATION: the read model is empty.
    expect(leadRows()).toHaveLength(0);

    // And the LEDGER says so, not just the return value.
    const row = ledgerRow(executionId);
    expect(row.execution_status).toBe('completed');
    expect(row.outcome).toBe('discovered_not_projected');
    expect(row.results_ingested).toBe(2);
    expect(String(row.detail)).toContain('read-model projection');
    expect(String(row.detail)).toContain('0 persisted');
  });

  it('a `pending_reconciliation` verdict is not projection either', async () => {
    // A socket that died after the POST went out. The row MAY exist; nobody
    // has established that it does, so discovery may not claim it.
    leadUpsertError = { code: '', message: 'TypeError: terminated', details: 'TypeError: terminated' };
    leadUpsertStatus = 0;

    const { run } = await discover();

    expect(run.resultsIngested).toBe(2);
    expect(run.outcome).toBe('discovered_not_projected');
    expect(run.resultsProjected).toBe(0);
    expect(run.resultsNeedingAttention).toBe(2);
    expect(leadRows()).toHaveLength(0);
  });

  it('a PARTIAL projection is not full success', async () => {
    failLeadUpsertNth = 2; // the second prospect is refused by RLS

    const { executionId, run } = await discover();

    expect(run.resultsIngested).toBe(2);
    expect(run.outcome).toBe('discovered_partially_projected');
    expect(run.resultsProjected).toBe(1);
    expect(run.resultsNeedingAttention).toBe(1);

    // Exactly one row exists, and the counter names the same number.
    expect(leadRows()).toHaveLength(1);
    expect(run.resultsProjected).toBe(leadRows().length);
    expect(String(ledgerRow(executionId).detail)).toContain('1 persisted');
  });

  it('a fully projected run still closes as `discovered`, and the rows are there', async () => {
    const { executionId, run } = await discover();

    expect(run.status).toBe('completed');
    expect(run.outcome).toBe('discovered');
    expect(run.resultsObserved).toBe(2);
    expect(run.resultsIngested).toBe(2);
    expect(run.resultsProjected).toBe(2);
    expect(run.resultsNeedingAttention).toBe(0);

    // The read model really holds them, one per vendor record.
    expect(leadRows()).toHaveLength(2);
    for (const row of leadRows()) expect(String(row.id).length).toBeGreaterThan(0);

    // A fully projected run carries NO shortfall detail.
    expect(ledgerRow(executionId).detail).toBeNull();
    expect(ledgerRow(executionId).outcome).toBe('discovered');
  });

  it('an empty vendor page is still `no_results`, unchanged', async () => {
    const { run } = await discover([]);
    expect(run.outcome).toBe('no_results');
    expect(run.resultsObserved).toBe(0);
    expect(run.resultsProjected).toBe(0);
    expect(leadRows()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PI-LDB - unknown projection degrades to unknown, never to success', () => {
  it('an ingestion boundary that states no projection counters -> unreported, not `discovered`', async () => {
    // The one case the real `ingestLeadBatch` cannot produce (all four of its
    // return paths set both counters), and precisely the one a later change
    // could reintroduce. `null` is the honest answer; `discovered` is not.
    const { executionId, run } = await discover(VENDOR_PAGE, {
      ingest: (async (input: { records: unknown[] }) => ({
        organizationId: ORG, source: PROVIDER,
        total: input.records.length, succeeded: input.records.length, failed: 0,
        outcomes: [],
      })) as unknown as DiscoveryPorts['ingest'],
    });

    expect(run.resultsIngested).toBe(2);
    expect(run.outcome).toBe('discovered_projection_unreported');
    expect(run.resultsProjected).toBeNull();
    expect(run.resultsNeedingAttention).toBeNull();
    expect(String(ledgerRow(executionId).detail)).toContain('unreported');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PI-LDB - the discovery invariant', () => {
  it('INVARIANT: resultsProjected === the number of rows the store holds', async () => {
    const cases: Array<{ label: string; arrange: () => void; expected: number }> = [
      { label: 'schema not applied', expected: 0, arrange: () => {
        leadUpsertError = { code: '42P01', message: 'no such relation' };
      } },
      { label: 'denied', expected: 0, arrange: () => {
        leadUpsertError = { code: '42501', message: 'RLS refused' };
      } },
      { label: 'one of two refused', expected: 1, arrange: () => { failLeadUpsertNth = 1; } },
      { label: 'both written', expected: 2, arrange: () => undefined },
    ];

    const seen: Array<{ label: string; projected: number | null; rows: number }> = [];
    for (let index = 0; index < cases.length; index += 1) {
      const c = cases[index];
      tables.clear();
      idSequence = 0;
      leadUpsertCalls = 0;
      leadUpsertError = null;
      leadUpsertStatus = 200;
      failLeadUpsertNth = null;
      c.arrange();
      const { run } = await discover(VENDOR_PAGE, {}, `discovery:invariant:${index}`);
      seen.push({ label: c.label, projected: run.resultsProjected, rows: leadRows().length });
    }

    for (const s of seen) expect(s.projected).toBe(s.rows);
    expect(seen.map((s) => s.rows)).toEqual(cases.map((c) => c.expected));
    // And only the last one was entitled to call itself a plain discovery.
    expect(seen.map((s) => s.projected)).toEqual([0, 0, 1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PI-LDB - retry and replay stay idempotent', () => {
  it('the same search re-run after a projection failure projects without duplicating', async () => {
    leadUpsertError = { code: '42P01', message: 'no such relation' };
    const first = await discover(VENDOR_PAGE, {}, 'discovery:retry:1');
    expect(first.run.outcome).toBe('discovered_not_projected');
    expect(leadRows()).toHaveLength(0);

    // The migration is applied, and the operator runs the search again. The
    // first execution is CLOSED, so the live slot is free and this is attempt 2.
    leadUpsertError = null;
    const second = await discover(VENDOR_PAGE, {}, 'discovery:retry:2');

    expect(second.executionId).not.toBe(first.executionId);
    expect(second.run.outcome).toBe('discovered');
    expect(second.run.resultsProjected).toBe(2);
    expect(leadRows()).toHaveLength(2);

    // The first execution's ledger row is NOT rewritten: its honest failure
    // stays history.
    expect(ledgerRow(first.executionId).outcome).toBe('discovered_not_projected');
  });

  it('the SAME candidates discovered a third time add no rows', async () => {
    const first = await discover(VENDOR_PAGE, {}, 'discovery:idem:1');
    expect(first.run.resultsProjected).toBe(2);
    expect(leadRows()).toHaveLength(2);

    const again = await discover(VENDOR_PAGE, {}, 'discovery:idem:2');
    expect(again.run.outcome).toBe('discovered');
    expect(again.run.resultsProjected).toBe(2);
    // The upsert is keyed on (company_id, dedupe_key): two prospects, still.
    expect(leadRows()).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PI-LDB 2B - the ledger row is closed even when the executor raises', () => {
  /**
   * THE DEFECT. Everything after the attempt is CLAIMED runs while this
   * executor holds a lease. Every anticipated outcome leaves through `close`,
   * which settles the row - but an UNANTICIPATED throw left no trace, and the
   * handoff to `ingestLeadBatch` sits AFTER the provider call.
   *
   * So the shape of the bug was: the vendor was called and billed, the page
   * came back, the handoff threw, `runDiscoveryExecution` threw, nothing
   * closed the row, and it sat with `completed_at` NULL holding its lease
   * until it expired. The route's own catch answered 500 and recorded
   * nothing, so the ledger - the only durable account of a billed search -
   * showed a search still in flight that nothing was executing.
   *
   * The observation point is the REAL ledger row, read back out of the store.
   */
  it('an ingestion throw settles the row as failed instead of abandoning it', async () => {
    const boom = new Error('ingestLeadBatch: organizationId is required — ingestion is never tenant-less');
    const { executionId, run } = await discover(VENDOR_PAGE, {
      ingest: (async () => { throw boom; }) as never,
    });

    // THE ROW IS CLOSED. This is the whole fix.
    const row = ledgerRow(executionId);
    expect(row.completed_at).toBe(NOW);
    expect(row.execution_status).toBe('failed');
    expect(row.outcome).toBe('executor_failed');
    expect(String(row.detail)).toContain('organizationId is required');

    // And it is closed TRUTHFULLY. The provider WAS called, so the call state
    // is `unknown` rather than `not_called`: the request may have been billed,
    // and claiming otherwise would invite a retry to pay for it twice.
    expect(row.provider_call_state).toBe('unknown');
    expect(row.provider_calls_made).toBe(1);
    expect(row.results_observed).toBe(VENDOR_PAGE.length);

    expect(run.status).toBe('failed');
    expect(run.outcome).toBe('executor_failed');
    expect(run.stopReason).toBe('executor_failed');
    // Projection counters DEGRADE TO UNKNOWN, not to zero. The throw may have
    // landed mid-handoff; zero would be a claim, null is the truth.
    expect(run.resultsProjected).toBeNull();
    expect(run.resultsNeedingAttention).toBeNull();
  });

  it('a ledger write that fails too rethrows the ORIGINAL failure, not its consequence', async () => {
    // The guard cannot close the row, so the lease really does survive. What
    // must NOT happen is the cause being replaced by the symptom: an operator
    // reading "could not complete the execution" would go looking at the
    // ledger when the answer is in the ingestion path.
    const boom = new Error('the original ingestion failure');
    await expect(discover(VENDOR_PAGE, {
      ingest: (async () => { throw boom; }) as never,
      complete: (async () => { throw new Error('the ledger write also failed'); }) as never,
    })).rejects.toThrow('the original ingestion failure');
  });

  it('the pre-lease refusals still THROW - the guard did not swallow them', async () => {
    // These two happen BEFORE anything is claimed, so there is no lease to
    // release and no row to settle. A guard that caught them would turn
    // "another tenant's execution id" into a settled failure on a row this
    // caller may not even see.
    await expect(runDiscoveryExecution({
      organizationId: ORG, executionId: 'no-such-execution', ports: externalPorts(),
    })).rejects.toThrow('discovery execution not found for this tenant');

    const { executionId } = await discover();
    await expect(runDiscoveryExecution({
      organizationId: ORG, executionId, ports: externalPorts(),
    })).rejects.toThrow('is already closed');
  });

  it('a successful run is untouched by the guard', async () => {
    // The guard must be invisible on the happy path, or it is not a guard but
    // a behaviour change.
    const { executionId, run } = await discover();
    expect(run.status).toBe('completed');
    expect(run.outcome).toBe('discovered');
    expect(run.stopReason).not.toBe('executor_failed');
    expect(ledgerRow(executionId).execution_status).toBe('completed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PI-LDB 2B - one throwing record does not discard the batch', () => {
  /**
   * `IngestionRejection`'s own comment states the principle - a batch stopped
   * mid-flight "still returns the outcomes it already had" - and the adapter
   * contract says a translation failure "must never abort a batch". The
   * `ingestNormalizedRecord` call site had no guard, so an unexpected throw
   * did abort it, discarding the outcomes of every record already processed
   * AFTER the provider had been paid.
   *
   * `recordPiIngestionContribution` is the throw source used here because it
   * is a REAL unguarded await on that path, not a synthetic one.
   */
  afterEach(() => { jest.restoreAllMocks(); });

  /**
   * Throws for ONE named record and returns a benign outcome for the others.
   *
   * The orchestrator DISCARDS this call's return value - it awaits it purely
   * for the write - so a stub return changes nothing about the record's fate,
   * and keeping the stub avoids making this test depend on the contribution
   * writer's own behaviour. `{ status: 'skipped' }` is a legal
   * `PiContributionOutcome` and is exactly what an unmapped adapter produces.
   */
  const throwFor = (externalId: string) =>
    jest.spyOn(piContribution, 'recordPiIngestionContribution').mockImplementation(
      async (input: { externalId: string | null }) => {
        if (input.externalId === externalId) throw new Error('contribution writer exploded');
        return { status: 'skipped', reason: 'unmapped_source' } as never;
      },
    );

  it('the failing record is reported by name and the others still ingest', async () => {
    throwFor('V-1');

    const { executionId, run } = await discover(VENDOR_PAGE);

    // THE BATCH SURVIVED. One record failed; the rest were ingested and
    // projected, and the run closed truthfully rather than throwing.
    expect(VENDOR_PAGE.length).toBeGreaterThan(1);
    expect(run.status).toBe('completed');
    expect(run.resultsObserved).toBe(VENDOR_PAGE.length);
    expect(run.resultsIngested).toBe(VENDOR_PAGE.length - 1);
    expect(leadRows()).toHaveLength(VENDOR_PAGE.length - 1);

    // The ledger row exists and accounts for the page, rather than being
    // abandoned mid-flight.
    const row = ledgerRow(executionId);
    expect(row.completed_at).toBe(NOW);
    expect(row.results_observed).toBe(VENDOR_PAGE.length);
    expect(row.results_ingested).toBe(VENDOR_PAGE.length - 1);
  });

  it('every record throwing still closes the row, with nothing claimed', async () => {
    jest.spyOn(piContribution, 'recordPiIngestionContribution').mockImplementation(
      async () => { throw new Error('contribution writer exploded'); },
    );

    const { executionId, run } = await discover(VENDOR_PAGE);

    expect(run.resultsIngested).toBe(0);
    expect(leadRows()).toHaveLength(0);
    // Observed but not ingested, and NOT reported as a discovery. The
    // projection counters are reported (the boundary did answer), and they
    // say zero - which is why `discovered` is withheld.
    expect(run.resultsProjected).toBe(0);
    // Named for what actually happened. `discovered` here would be a billed
    // search reporting a discovery that produced nothing durable - and it WAS
    // reachable, because 0 ingested means 0 needing attention, which the
    // projection branches would have read as "all clear".
    expect(run.outcome).toBe('discovered_not_ingested');
    // `detail` is a LEDGER column, not a field on `RunDiscoveryResult` - the
    // result reports `outcome` and `stopReason`, and the prose lives on the row.
    // (Caught by the backend-test typecheck gate, which jest cannot see.)
    expect(String(ledgerRow(executionId).detail)).toContain('0 ingested');
    expect(ledgerRow(executionId).completed_at).toBe(NOW);
  });
});
