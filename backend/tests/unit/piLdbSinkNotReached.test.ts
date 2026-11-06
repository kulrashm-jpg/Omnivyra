/**
 * PI-LDB P0 — the SINK-NOT-REACHED path cannot manufacture persistence.
 *
 * ─── WHAT THIS SUITE GUARDS ───────────────────────────────────────────────
 * `ingestNormalizedRecord` wraps `durableLeadIntelligenceSink` in an observing
 * sink and keeps the verdict, because `ingestCanonicalLead` returns the lead it
 * CONSTRUCTED, not the row that was written. When no verdict was observed, the
 * orchestrator falls back to
 *
 *   pendingReconciliation('no_row_returned', 'the durable sink was not reached')
 *
 * (`backend/services/leadIngestion/orchestrator.ts:667-668`). That default is
 * the whole safety property: a future change that stops calling the sink, a
 * sink substituted for a no-op, or a module mocked away must degrade to
 * "unconfirmed" and NEVER to "success". Defaulting the other way is precisely
 * the P0 defect this programme exists to close.
 *
 * ─── WHAT IS REAL HERE, AND WHY ───────────────────────────────────────────
 * Every test drives the real production entry point `ingestNormalizedRecord`,
 * and the observation point is the orchestrator's OWN return value
 * (`outcome.leadProjection`) read through the real `isProjected` /
 * `needsAttention` predicates — never a `jest.fn` call count. The suite this
 * one complements, `piLdbDurableLeadProjection.test.ts`, doubles the sink and
 * counts invocations; that is exactly the observation point that let
 * `emitted: true` pass for a record that wrote nothing, so it is not used to
 * answer the persistence question here.
 *
 * Substitution happens at BOUNDARIES only:
 *
 *   `backend/db/writeOwner`  — the lowest seam. Doubled with a fake that keys
 *                              rows exactly as `lead_intelligence_dedupe_unique
 *                              (company_id, dedupe_key)` does, so "persisted"
 *                              can be cross-checked against a row that really
 *                              exists in the store. The repository's error
 *                              handling, `toRow`, `computeLeadDedupeKey`, the
 *                              reconciliation read and the sink's verdict logic
 *                              are all the real implementations above it.
 *   sibling services         — identity (W1), accounts (W4), prospects (WS-1),
 *                              provenance (LI-2), duplicates (LI-4C), the
 *                              feature flag. None of them is the unit under
 *                              test and all of them need a database.
 *
 * Two tests additionally substitute ONE module each, because the condition
 * under test is by definition a missing or degraded collaborator:
 *
 *   * the canonical pipeline (`lib/leadIntelligence.ingestCanonicalLead`),
 *     replaced with a version that never calls `ports.sink` — the regression
 *     the fallback was written for. Every OTHER export of that barrel
 *     (`pendingReconciliation`, `skipped`, `failed`, `projectionFailureFrom`,
 *     `isProjected`) stays the real one via `requireActual`, so the verdict
 *     being asserted is produced by production code.
 *   * `durableLeadIntelligenceSink`, replaced with a no-op that resolves with
 *     nothing — "a sink adapter is present but its implementation is a no-op",
 *     and also what `jest.mock` of that module does to any other suite.
 *
 * In both of those, the claim "no write was attempted" is proved at the DB
 * boundary (`upsertPayloads` / `rows`), not by asserting that a mock was not
 * called.
 */

import { isProjected, needsAttention } from '../../../lib/leadIntelligence';

/* ── the fake database (the ONLY infrastructure seam) ──────────────────────*/

type DbError = { code?: string; message?: string; details?: string | null };

/** Rows that actually landed, keyed as the real unique index is. */
const rows = new Map<string, Record<string, unknown>>();
const upsertPayloads: Array<Record<string, unknown>> = [];
const timelinePayloads: Array<Record<string, unknown>> = [];
const reconcileReads: Array<{ companyId: string; dedupeKey: string }> = [];
/** The score-protection read (Prompt 2B), kept apart from the one above. */
const protectiveReads: Array<{ companyId: string; dedupeKey: string }> = [];

/** One knob per database answer. */
let upsertError: DbError | null = null;
let upsertStatus: number | null = 200;
/** Accepted, no error, no row handed back — the ambiguous case. */
let upsertReturnsNoRow = false;

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) }),
  ownedDbTable: (table: string) => ({
    upsert(row: Record<string, unknown>) {
      upsertPayloads.push(row);
      return {
        select: () => ({
          maybeSingle: async () => {
            if (upsertError) return { data: null, error: upsertError, status: upsertStatus };
            if (upsertReturnsNoRow) return { data: null, error: null, status: 200 };
            // Real upsert semantics: same (company_id, dedupe_key) => same id.
            const key = String(row.company_id) + '|' + String(row.dedupe_key);
            const existing = rows.get(key);
            const id = existing ? String(existing.id) : 'row-' + String(rows.size + 1);
            rows.set(key, { ...row, id });
            return { data: { id }, error: null, status: 200 };
          },
        }),
      };
    },
    async insert(row: Record<string, unknown>) {
      if (table === 'lead_intelligence_events') timelinePayloads.push(row);
      return { data: null, error: null };
    },
    // The reconciliation read, served from the SAME store the upsert writes to,
    // keyed exactly as the real unique index is. So "the row was found" can only
    // be true here if the write really put it there.
    select(columns: string) {
      const filters: Record<string, string> = {};
      const chain = {
        eq(column: string, value: string) {
          filters[column] = value;
          return chain;
        },
        // PROMPT 2C. The real builder exposes `retry` and returns itself; the
        // repository turns postgrest-js's auto-retry OFF for the
        // score-protection read. A double without this method makes that call
        // throw rather than answer, which routes the whole suite down a path
        // it is not testing.
        retry(_enabled: boolean) {
          return chain;
        },
        maybeSingle: async () => {
      // PROMPT 2B. The repository now issues TWO different keyed reads, and a
      // double that cannot tell them apart would make every count below
      // ambiguous:
      //
      //   select('id')          the RECONCILIATION read, after an unconfirmed
      //                         write - "did the row land anyway?"
      //   select('id, scores')  the SCORE-PROTECTION read, before the write -
      //                         "is there a stored score I must not silently
      //                         replace?"
      //
      // They are discriminated by the column list, which is exactly how they
      // are discriminated on the real wire.
          (String(columns).includes('scores') ? protectiveReads : reconcileReads)
            .push({ companyId: filters.company_id, dedupeKey: filters.dedupe_key });
          if (table !== 'lead_intelligence') return { data: null, error: null };
          const hit = rows.get(filters.company_id + '|' + filters.dedupe_key);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return chain;
    },
  }),
}));

/* ── sibling-service boundaries (none is the unit under test) ──────────────*/

let prospectId: string | null = 'prospect-1';

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => ({
    sourceRecordId: 'sr-1',
    outcome: 'created',
    assertionsRecorded: 1,
    assertionsAlreadyPresent: 0,
    canonicalApplied: [],
    canonicalWithheld: [],
  })),
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({
    unifiedPersonId: 'person-1',
    matchedBy: 'email',
    created: false,
  })),
}));

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
  attachPersonToAccount: jest.fn(async () => undefined),
}));

jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => ({
    organizationId: 'org',
    prospectId,
    subjectId: 'subject-1',
    outcome: 'created',
    externalLeadKey: 'K1',
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

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';
import type { AdapterResult } from '../../services/leadIngestion/contracts';

type Orchestrator = typeof import('../../services/leadIngestion/orchestrator');

const SINK_MODULE = '../../services/leadIntelligence/durableLeadIntelligenceSink';
const PIPELINE_MODULE = '../../../lib/leadIntelligence';

/**
 * A fresh orchestrator with ONE collaborator module substituted.
 *
 * `jest.isolateModules` gives it its own module registry, so the suite's
 * default (fully real) orchestrator above is untouched. The DB double and the
 * sibling doubles are re-created from the same factories and close over the
 * same counters in this file, so `upsertPayloads` / `rows` keep observing.
 */
function orchestratorWithout(modulePath: string, factory: () => unknown): Orchestrator {
  let mod!: Orchestrator;
  jest.isolateModules(() => {
    jest.doMock(modulePath, factory);
    mod = require('../../services/leadIngestion/orchestrator') as Orchestrator;
  });
  jest.dontMock(modulePath);
  return mod;
}

/** The pipeline, with every real export EXCEPT one that never reaches the sink. */
const pipelineThatNeverCallsTheSink = () => ({
  ...(jest.requireActual(PIPELINE_MODULE) as object),
  ingestCanonicalLead: async (
    input: Record<string, unknown>,
    ports: { now?: () => string },
  ) => ({ ...input, unifiedPersonId: 'person-1', ingestedAt: ports.now ? ports.now() : 'now' }),
});

/* ── the record ────────────────────────────────────────────────────────────*/

const ORG = '00000000-0000-4000-8000-0000000000aa';

const csvRecord = (over: Partial<AdapterResult['normalized']> = {}): AdapterResult => ({
  raw: { Designation: 'Snr. Procurement Mgr' },
  normalized: {
    organizationId: ORG,
    source: 'csv',
    entityType: 'person',
    externalId: 'ROW-1',
    person: {
      email: 'ada@babbage.example',
      phone: '+442079460958',
      fullName: 'Ada Lovelace',
      jobTitle: 'Senior Procurement Manager',
      externalKeys: { csv: { external_id: 'ROW-1' } },
    },
    observedAt: '2026-11-02T10:00:00.000Z',
    ...over,
  },
});

const INGESTION_FLAG = 'ENABLE_LEAD_INGESTION';
let flagBefore: string | undefined;
beforeAll(() => {
  flagBefore = process.env[INGESTION_FLAG];
});
afterAll(() => {
  if (flagBefore === undefined) delete process.env[INGESTION_FLAG];
  else process.env[INGESTION_FLAG] = flagBefore;
});

function resetWorld() {
  process.env[INGESTION_FLAG] = 'true';
  rows.clear();
  upsertPayloads.length = 0;
  timelinePayloads.length = 0;
  reconcileReads.length = 0; protectiveReads.length = 0;
  upsertError = null;
  upsertStatus = 200;
  upsertReturnsNoRow = false;
  prospectId = 'prospect-1';
}

beforeEach(resetWorld);

/* ───────────────────────────────────────────────────────────────────────────
 * 1. A SINK-NOT-REACHED PATH CANNOT RETURN `persisted`
 * ──────────────────────────────────────────────────────────────────────────*/

describe('the sink was never reached', () => {
  it('degrades to pending_reconciliation and NEVER to persisted', async () => {
    // The regression the fallback exists for: the pipeline stops calling the
    // sink. Only `ingestCanonicalLead` is substituted; the verdict asserted
    // below is built by the real `pendingReconciliation`.
    const orch = orchestratorWithout(PIPELINE_MODULE, pipelineThatNeverCallsTheSink);

    const out = await orch.ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('pending_reconciliation');
    expect(projection.status).not.toBe('persisted');
    expect(projection.reason).toBe('no_row_returned');
    expect(projection.error).toBe('the durable sink was not reached');
    expect(projection.leadId).toBeNull();

    // Read through the production predicates, not by eyeballing the status.
    expect(isProjected(projection)).toBe(false);
    expect(needsAttention(projection)).toBe(true);

    // Proved at the DATABASE boundary, not by a mock's call count: nothing was
    // ever submitted, and no row exists under the real unique key.
    expect(upsertPayloads).toHaveLength(0);
    expect(rows.size).toBe(0);
    expect(timelinePayloads).toHaveLength(0);

    // Fail-open is preserved: the person, employer, prospect and evidence above
    // the projection are durable, so the record is still a successful ingestion
    // that CARRIES the unconfirmed verdict.
    expect(out.ok).toBe(true);
    expect(out.prospectId).toBe('prospect-1');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 2. A NO-OP SINK CANNOT CLAIM PERSISTENCE
 * ──────────────────────────────────────────────────────────────────────────*/

describe('a no-op sink adapter', () => {
  it.each([
    ['resolves with undefined', async () => undefined],
    ['resolves with null', async () => null],
  ])('is present, writes nothing, and cannot claim persistence (%s)', async (_label, emit) => {
    // This is also exactly what `jest.mock('.../durableLeadIntelligenceSink')`
    // leaves behind for any other suite: an auto-mocked `emit` that resolves
    // with `undefined`. The real pipeline DOES call it.
    const orch = orchestratorWithout(SINK_MODULE, () => ({
      durableLeadIntelligenceSink: { emit },
    }));

    const out = await orch.ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('pending_reconciliation');
    expect(projection.reason).toBe('no_row_returned');
    expect(projection.error).toBe('the durable sink was not reached');
    expect(projection.leadId).toBeNull();
    expect(isProjected(projection)).toBe(false);
    expect(needsAttention(projection)).toBe(true);

    // The no-op really was a no-op.
    expect(upsertPayloads).toHaveLength(0);
    expect(rows.size).toBe(0);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 3. A MISSING WRITE RESULT IS NOT A SUCCESSFUL PROJECTION
 * ──────────────────────────────────────────────────────────────────────────*/

describe('the write was accepted and handed back no row', () => {
  it('is never read as a successful projection', async () => {
    // REAL sink, REAL repository, REAL pipeline, REAL orchestrator. Only the
    // database is doubled, and it answers `{ data: null, error: null }` — the
    // shape that used to be flattened to success one hop up.
    upsertReturnsNoRow = true;

    const out = await ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('pending_reconciliation');
    expect(projection.status).not.toBe('persisted');
    expect(projection.leadId).toBeNull();
    expect(isProjected(projection)).toBe(false);
    expect(needsAttention(projection)).toBe(true);

    // The write WAS attempted and the row genuinely is not there, so the
    // verdict is the honest one and not the sink-not-reached fallback.
    expect(upsertPayloads).toHaveLength(1);
    expect(rows.size).toBe(0);
    expect(projection.error).not.toBe('the durable sink was not reached');

    // Reconciliation LOOKED, on the same key the write used, and said so.
    expect(reconcileReads).toHaveLength(1);
    expect(reconcileReads[0].companyId).toBe(ORG);
    expect(reconcileReads[0].dedupeKey).toBe(String(upsertPayloads[0].dedupe_key));
    expect(projection.warnings.join(' ')).toContain('did not find it yet');

    // No timeline event for a row whose existence is unestablished.
    expect(timelinePayloads).toHaveLength(0);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 4. A VALID `no_prospect` IS STILL A LEGITIMATE SKIP
 * ──────────────────────────────────────────────────────────────────────────*/

describe('no canonical prospect to project', () => {
  it('remains a legitimate skip, not a failure and not a false success', async () => {
    // WS-1 returns a null prospectId for a partial record rather than minting
    // one. There is nothing to project, and the sink is correctly not reached —
    // but through the guard ABOVE the try block, not through the fallback.
    prospectId = null;

    const out = await ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('skipped');
    expect(projection.reason).toBe('no_prospect');
    expect(projection.leadId).toBeNull();
    expect(projection.error).toBeNull();

    // A skip must NOT be raised to the operator: warning about a record that
    // had nothing to list trains them to ignore the warning that matters.
    expect(isProjected(projection)).toBe(false);
    expect(needsAttention(projection)).toBe(false);

    // And it is distinguishable from the sink-not-reached fallback, which is
    // the whole reason `skipped` and `pending_reconciliation` are separate.
    expect(projection.error).not.toBe('the durable sink was not reached');
    expect(upsertPayloads).toHaveLength(0);
    expect(out.ok).toBe(true);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 5. A CONFIRMED DURABLE ROW STILL PRODUCES `persisted`
 * ──────────────────────────────────────────────────────────────────────────*/

describe('the database confirmed the row by returning its id', () => {
  it('produces persisted, and the id is the one the store actually holds', async () => {
    // Nothing is doubled above the database. The pessimistic fallback must not
    // have made the honest success path unreachable.
    const out = await ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('persisted');
    expect(projection.reason).toBeNull();
    expect(isProjected(projection)).toBe(true);
    expect(needsAttention(projection)).toBe(false);

    // The claim is tied to a row that EXISTS in the store, under the same
    // (company_id, dedupe_key) the real unique index uses. A `persisted` whose
    // id matches no row would fail here.
    expect(rows.size).toBe(1);
    const stored = rows.get(ORG + '|' + String(upsertPayloads[0].dedupe_key));
    expect(stored).toBeDefined();
    expect(projection.leadId).toBe(String(stored!.id));
    expect(typeof projection.leadId).toBe('string');
    expect(projection.leadId).not.toBe('');

    // Established by the write's OWN answer, so no read-back happened and the
    // timeline event is appended exactly once.
    expect(reconcileReads).toHaveLength(0);
    expect(projection.reconciled).not.toBe(true);
    expect(timelinePayloads).toHaveLength(1);
    expect(timelinePayloads[0].lead_id).toBe(projection.leadId);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * 6. A GENUINELY UNCERTAIN WRITE PRODUCES `pending_reconciliation`
 * ──────────────────────────────────────────────────────────────────────────*/

describe('the write may or may not have landed', () => {
  it.each([
    ['08006', 'connection_failure'],
    ['08007', 'transaction_resolution_unknown'],
    ['57014', 'query_canceled'],
  ])('reports pending_reconciliation for %s (%s), never persisted and never failed', async (code) => {
    // A connection that dropped AFTER the upsert was transmitted. Calling this
    // `failed` sends an operator to re-enter data that may already be there;
    // calling it `persisted` is the P0. The honest answer is the fourth state.
    upsertError = { code, message: 'connection terminated unexpectedly' };
    upsertStatus = null;

    const out = await ingestNormalizedRecord(csvRecord());
    const projection = out.leadProjection!;

    expect(projection.status).toBe('pending_reconciliation');
    expect(projection.status).not.toBe('persisted');
    expect(projection.status).not.toBe('failed');
    expect(projection.leadId).toBeNull();
    expect(isProjected(projection)).toBe(false);
    expect(needsAttention(projection)).toBe(true);

    // It reached the database boundary, so this is the classifier's verdict and
    // not the sink-not-reached fallback — two different facts that must stay
    // distinguishable to an operator.
    expect(upsertPayloads).toHaveLength(1);
    expect(projection.error).not.toBe('the durable sink was not reached');
    expect(reconcileReads).toHaveLength(1);
    expect(rows.size).toBe(0);
    expect(out.ok).toBe(true);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE INVARIANT, ACROSS EVERY ROUTE ABOVE
 * ──────────────────────────────────────────────────────────────────────────*/

describe('persistence is claimed if and only if a row exists', () => {
  it('holds for every projection route the orchestrator can take', async () => {
    const run = async (arrange: () => Orchestrator | void) => {
      resetWorld();
      // `arrange` is typed `=> Orchestrator | void` because most arrangers only
      // set a flag. TypeScript does not treat `void` as nullish, so `??` leaves
      // it in the result type and the call below is a TS2339. The runtime value
      // really is `Orchestrator | undefined`, so that is what it is read as.
      const arranged = arrange() as Orchestrator | undefined;
      const orch = arranged ?? ({ ingestNormalizedRecord } as unknown as Orchestrator);
      const out = await orch.ingestNormalizedRecord(csvRecord());
      return out.leadProjection!;
    };

    const routes: Array<[string, () => Orchestrator | void]> = [
      ['pipeline never calls the sink', () => orchestratorWithout(PIPELINE_MODULE, pipelineThatNeverCallsTheSink)],
      ['no-op sink', () => orchestratorWithout(SINK_MODULE, () => ({ durableLeadIntelligenceSink: { emit: async () => undefined } }))],
      ['accepted, no row returned', () => { upsertReturnsNoRow = true; }],
      ['no canonical prospect', () => { prospectId = null; }],
      ['confirmed row', () => undefined],
      ['uncertain write', () => { upsertError = { code: '08006', message: 'gone' }; upsertStatus = null; }],
      ['schema not applied', () => { upsertError = { code: '42P01', message: 'relation does not exist' }; }],
      ['denied by RLS', () => { upsertError = { code: '42501', message: 'permission denied' }; }],
    ];

    for (const [label, arrange] of routes) {
      const projection = await run(arrange);
      // The one assertion that would catch ANY route inventing a success: a
      // projection claims the Lead Database will list this lead exactly when a
      // row is in the store, and it names that row's id.
      const rowExists = rows.size === 1;
      expect({ label, projected: isProjected(projection) }).toEqual({ label, projected: rowExists });
      if (isProjected(projection)) {
        expect(typeof projection.leadId).toBe('string');
        expect(projection.leadId).not.toBe('');
        expect([...rows.values()].map((r) => String(r.id))).toContain(projection.leadId);
      } else {
        expect(projection.leadId).toBeNull();
      }
    }
  });
});
