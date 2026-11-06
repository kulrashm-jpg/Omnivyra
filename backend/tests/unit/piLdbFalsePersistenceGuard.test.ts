/**
 * PI-LDB - FALSE PERSISTENCE GUARD
 *
 * `persisted` is DEFINED as "the write returned the row's id". These tests hold
 * the converse: a write that hands back a row WITHOUT a usable id must never
 * produce `persisted`, because `isProjected()` would then answer true for a
 * lead the Lead Database cannot list - the original P0 in a new costume.
 *
 * Three routes were demonstrated reachable through the REAL repository, REAL
 * sink and REAL orchestrator before this was guarded, with only the database
 * doubled:
 *
 *   data = {}           -> String(undefined) === 'undefined'  (TRUTHY)
 *   data = { id: null } -> String(null)      === 'null'       (TRUTHY)
 *   data = { id: '' }   -> persisted('') -> the sink's own defensive throw
 *                          carried `status:'persisted'` back out, and
 *                          `projectionFailureFrom` returned it unvalidated
 *
 * The first two produced NO error signal at all and still wrote a provenance
 * event naming `lead_id: "undefined"`. The third is the sharper one: two
 * independent guards cancelled each other out, because a thrown
 * `LeadProjectionFailure` means "not a confirmed row" BY DEFINITION, yet the
 * orchestrator trusted its payload's `status`.
 *
 * Guarded in two places, and these tests fail if EITHER is reverted:
 *   - `leadIntelligenceRepository` refuses to mint a verdict from an unusable
 *     id and reconciles instead (look, never guess).
 *   - `isLeadProjectionResult` refuses a `persisted` verdict carrying no
 *     `leadId`, which covers every unwrap, `projectionFailureFrom` included.
 *
 * The observation point is deliberately NOT a `jest.fn` call count: it is the
 * orchestrator's own returned verdict, cross-checked against whether a row
 * actually exists in the doubled store.
 */

import { isProjected, needsAttention } from '../../../lib/leadIntelligence';
import { isLeadProjectionResult, projectionFailureFrom } from '../../../lib/leadIntelligence/projectionResult';
import { LeadProjectionFailure } from '../../services/leadIntelligence/durableLeadIntelligenceSink';

type DbError = { code?: string; message?: string; details?: string | null };

const rows = new Map<string, Record<string, unknown>>();
const upsertPayloads: Array<Record<string, unknown>> = [];
const timelinePayloads: Array<Record<string, unknown>> = [];
const reconcileReads: Array<{ companyId: string; dedupeKey: string }> = [];
/** The score-protection read (Prompt 2B), kept apart from the one above. */
const protectiveReads: Array<{ companyId: string; dedupeKey: string }> = [];

let upsertError: DbError | null = null;
let upsertStatus: number | null = 200;
/** THE PROBE KNOB: what data the upsert select/maybeSingle resolves with. */
let upsertData: unknown = 'default';

jest.mock('../../db/writeOwner', () => ({
  ownedDbRpc: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) }),
  ownedDbTable: (table: string) => ({
    upsert(row: Record<string, unknown>) {
      upsertPayloads.push(row);
      return {
        select: () => ({
          maybeSingle: async () => {
            if (upsertError) return { data: null, error: upsertError, status: upsertStatus };
            if (upsertData !== 'default') {
              // Deliberately DO NOT store a row: the store stays empty, so any
              // persisted verdict here is provably false.
              return { data: upsertData, error: null, status: 200 };
            }
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
    select(columns: string) {
      const filters: Record<string, string> = {};
      const chain = {
        eq(column: string, value: string) { filters[column] = value; return chain; },
        // PROMPT 2C. The real builder exposes `retry` and returns itself; the
        // repository turns postgrest-js's auto-retry OFF for the
        // score-protection read. A double without it makes that call throw.
        retry(_enabled: boolean) { return chain; },
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

let prospectId: string | null = 'prospect-1';
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
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'person-1', matchedBy: 'email', created: false })),
}));
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
  attachPersonToAccount: jest.fn(async () => undefined),
}));
jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => ({
    organizationId: 'org', prospectId, subjectId: 'subject-1', outcome: 'created',
    externalLeadKey: 'K1', reason: 'created',
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

import { ingestNormalizedRecord, ingestLeadBatch } from '../../services/leadIngestion/orchestrator';
import type { AdapterResult } from '../../services/leadIngestion/contracts';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const csvRecord = (): AdapterResult => ({
  raw: { Designation: 'Snr. Procurement Mgr' },
  normalized: {
    organizationId: ORG, source: 'csv', entityType: 'person', externalId: 'ROW-1',
    person: {
      email: 'ada@babbage.example', phone: '+442079460958', fullName: 'Ada Lovelace',
      jobTitle: 'Senior Procurement Manager', externalKeys: { csv: { external_id: 'ROW-1' } },
    },
    observedAt: '2026-11-02T10:00:00.000Z',
  },
});

const INGESTION_FLAG = 'ENABLE_LEAD_INGESTION';
beforeEach(() => {
  process.env[INGESTION_FLAG] = 'true';
  rows.clear(); upsertPayloads.length = 0; timelinePayloads.length = 0;
  reconcileReads.length = 0; protectiveReads.length = 0;
  upsertError = null; upsertStatus = 200; upsertData = 'default'; prospectId = 'prospect-1';
});

/**
 * Every unusable id the database could hand back. The store is left EMPTY on
 * this path, so any `persisted` verdict here is provably false.
 */
describe('PI-LDB - a row with no usable id is never persistence', () => {
  it.each([
    ['the row object has no `id` at all', {}],
    ['`id` is null', { id: null }],
    ['`id` is an empty string', { id: '' }],
    ['`id` is an object', { id: {} }],
  ])('%s -> pending_reconciliation, never persisted', async (_label, data) => {
    upsertData = data;
    const out = await ingestNormalizedRecord(csvRecord());
    const p = out.leadProjection!;

    expect(p.status).not.toBe('persisted');
    expect(p.status).toBe('pending_reconciliation');
    expect(p.reason).toBe('no_row_returned');
    expect(p.leadId).toBeNull();

    // What the surfaces would read. This is the assertion that matters.
    expect(isProjected(p)).toBe(false);
    expect(needsAttention(p)).toBe(true);

    // No row exists, and crucially NO provenance event was fabricated. Before
    // the guard, two of these cases wrote `lead_id: "undefined"` / `"null"`
    // into `lead_intelligence_events` - a falsified history, which is the one
    // thing a provenance surface must never contain.
    expect(rows.size).toBe(0);
    expect(timelinePayloads).toHaveLength(0);

    // It DID attempt the write, and it DID look before giving up.
    expect(upsertPayloads).toHaveLength(1);
    expect(reconcileReads).toHaveLength(1);
    // And exactly one score-protection read preceded the write (Prompt 2B).
    expect(protectiveReads).toHaveLength(1);
  });

  it('a numeric id IS usable, and is carried as a string', async () => {
    // Postgres could legitimately answer with a non-string id. The guard
    // rejects unusable TYPES, not non-strings. This case asserts the coercion
    // contract only: the probe knob deliberately bypasses the store, so the
    // row-existence invariant is asserted by the INVARIANT test below.
    upsertData = { id: 4242 };
    const p = (await ingestNormalizedRecord(csvRecord())).leadProjection!;
    expect(p.status).toBe('persisted');
    expect(p.leadId).toBe('4242');
  });

  it('a real id still persists, and names a row that actually exists', async () => {
    const p = (await ingestNormalizedRecord(csvRecord())).leadProjection!;
    expect(p.status).toBe('persisted');
    expect(isProjected(p)).toBe(true);
    expect(rows.size).toBe(1);
    const stored = [...rows.values()][0];
    expect(p.leadId).toBe(String(stored.id));
    expect(p.leadId).not.toHaveLength(0);
    // The happy path is the one that MAY append provenance.
    expect(timelinePayloads).toHaveLength(1);
    expect(timelinePayloads[0].lead_id).toBe(String(stored.id));
  });

  it('INVARIANT: isProjected(verdict) === a row exists, across every id shape', async () => {
    const shapes: Array<[string, unknown]> = [
      ['no id', {}],
      ['null id', { id: null }],
      ['empty id', { id: '' }],
      ['real id', 'default'],
    ];
    const seen: Array<{ label: string; projected: boolean; rowExists: boolean }> = [];
    for (const [label, data] of shapes) {
      rows.clear(); upsertPayloads.length = 0; timelinePayloads.length = 0;
  reconcileReads.length = 0; protectiveReads.length = 0;
      upsertData = data;
      const p = (await ingestNormalizedRecord(csvRecord())).leadProjection!;
      seen.push({ label, projected: isProjected(p), rowExists: rows.size === 1 });
    }
    for (const s of seen) expect(s.projected).toBe(s.rowExists);
    expect(seen.map((s) => s.projected)).toEqual([false, false, false, true]);
  });
});

/**
 * The contract layer, tested directly. This is what closes the unwrap route:
 * the sink throws for EVERY non-persisted outcome, so a thrown verdict that
 * claims `persisted` is self-contradictory and must not survive the unwrap.
 */
describe('PI-LDB - the projection contract refuses an incoherent verdict', () => {
  const warnings: string[] = [];

  it.each([
    ['an empty leadId', { status: 'persisted', leadId: '', reason: null, warnings, error: null }],
    ['a null leadId', { status: 'persisted', leadId: null, reason: null, warnings, error: null }],
    ['no leadId at all', { status: 'persisted', reason: null, warnings, error: null }],
  ])('isLeadProjectionResult rejects a persisted verdict with %s', (_l, verdict) => {
    expect(isLeadProjectionResult(verdict)).toBe(false);
  });

  it('isLeadProjectionResult still accepts a persisted verdict that names its row', () => {
    expect(isLeadProjectionResult({
      status: 'persisted', leadId: 'lead-1', reason: null, warnings, error: null,
    })).toBe(true);
  });

  it('the non-persisted statuses are unaffected by the leadId rule', () => {
    for (const status of ['skipped', 'failed', 'pending_reconciliation']) {
      expect(isLeadProjectionResult({
        status, leadId: null, reason: 'no_row_returned', warnings, error: null,
      })).toBe(true);
    }
  });

  it('projectionFailureFrom refuses to unwrap a thrown verdict claiming persistence', () => {
    const incoherent = { status: 'persisted', leadId: '', reason: null, warnings, error: null };
    expect(projectionFailureFrom(new LeadProjectionFailure(incoherent as never))).toBeNull();
  });

  it('projectionFailureFrom still unwraps a genuine failure verdict', () => {
    const genuine = {
      status: 'failed', leadId: null, reason: 'schema_not_applied', warnings, error: 'boom',
    };
    expect(projectionFailureFrom(new LeadProjectionFailure(genuine as never))).toEqual(genuine);
  });
});
