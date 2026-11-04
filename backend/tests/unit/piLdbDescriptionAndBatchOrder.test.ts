/**
 * PI-LDB-6 — two contracts a working import depends on.
 *
 * ─── 1. `description` REACHES THE EMPLOYER ────────────────────────────────
 * `description` was a DEAD DESTINATION. The canonical field registry had the
 * key, `prospect_accounts` had the column, `ACCOUNT_ATTRIBUTE_COLUMNS` listed
 * it and `toAccountAttributes` already normalised it — but `ManualLeadInput`
 * had no field, so the adapter had nothing to read. The mapping engine could
 * propose `description` for a `Company Overview` column, a tenant could
 * approve it, and the value would be dropped by an import that reported
 * SUCCESS. A silent loss inside a success is the worst shape a defect takes,
 * because nothing downstream is wrong enough to notice.
 *
 * ─── 2. OUTCOMES ARE POSITIONAL ──────────────────────────────────────────
 * `outcomes[i]` is the outcome of `records[i]`. That was an undocumented,
 * untested implementation detail until a client started depending on it: a
 * record carries no identifier a browser can compute (`csvExternalId` is a
 * server-side digest, `externalId` is null without a reference), so POSITION
 * is the only key a client has for "retry what did not land". A refactor that
 * filtered or reordered outcomes would silently re-import the wrong rows.
 * These tests are what make that refactor fail loudly instead.
 */

import {
  toNormalizedManualRecord,
  validateManualInput,
  type ManualLeadInput,
} from '../../services/leadIngestion/adapters/manualAdapter';
import { toNormalizedCsvRecord } from '../../services/leadIngestion/adapters/csvAdapter';
import { ACCOUNT_ATTRIBUTE_COLUMNS } from '../../services/prospectIdentity/attributes';
import { CANONICAL_FIELDS } from '../../services/leadMapping/canonicalFieldRegistry';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const base = (over: Partial<ManualLeadInput> = {}): ManualLeadInput => ({
  organizationId: ORG,
  referenceId: 'ROW-1',
  fullName: 'Ada Lovelace',
  email: 'ada@babbage.example',
  companyName: 'Analytical Engines Ltd',
  companyDomain: 'engines.example',
  ...over,
});

const OVERVIEW = 'Builds general-purpose mechanical computing devices.';

/* ── 1. description, end to end ─────────────────────────────────────────── */

describe('PI-LDB-6 · description reaches the employer', () => {
  it('carries a company description onto the normalized ACCOUNT', () => {
    const record = toNormalizedManualRecord(base({ description: OVERVIEW }));
    expect(record.account?.description).toBe(OVERVIEW);
  });

  it('carries it on the CSV path too, which is the delivery target', () => {
    // `CsvLeadInput = ManualLeadInput` and `toNormalizedCsvRecord` delegates to
    // the manual translate, so this should follow — but "should follow" is how
    // a dropped field survives review. The 12-step CSV flow is the first
    // delivery target, so it gets its own assertion.
    const record = toNormalizedCsvRecord(base({ description: OVERVIEW }));
    expect(record.account?.description).toBe(OVERVIEW);
  });

  it('puts it on the EMPLOYER, never on the person', () => {
    const record = toNormalizedManualRecord(base({ description: OVERVIEW }));
    // The registry is explicit that this describes the employer: "Not a
    // product description, and not a note about the person."
    expect(JSON.stringify(record.person ?? {})).not.toContain('mechanical computing');
  });

  it('appears EXACTLY ONCE in the normalized record', () => {
    // The first version of this test asserted against `record.attribution`,
    // which does not exist on `NormalizedIngestionRecord` — so it compared the
    // description against `{}` and could never fail. The typechecker found it;
    // the test run did not, which is the whole argument for checking types on
    // test files too.
    //
    // This is what it was trying to say. One occurrence, and it is the account
    // column: a value copied into a second destination would be written twice,
    // and the duplicate would drift the moment either one was edited.
    const record = toNormalizedManualRecord(base({ description: OVERVIEW }));
    const occurrences = JSON.stringify(record).split(OVERVIEW).length - 1;
    expect(occurrences).toBe(1);
    expect(record.account?.description).toBe(OVERVIEW);
  });

  it('cannot conjure an employer on its own', () => {
    // The standing rule for every firmographic: an account is identified by
    // name, domain or external id. A description attached to no identifiable
    // company is a fact about nobody, so there must be no account at all —
    // not an account named after its own description.
    const record = toNormalizedManualRecord({
      organizationId: ORG,
      referenceId: 'ROW-2',
      email: 'ada@babbage.example',
      description: OVERVIEW,
    });
    expect(record.account).toBeNull();
  });

  it('passes the value through UNNORMALISED, leaving one owner for the rule', () => {
    // `toAccountAttributes` applies `normalizeDisplayText`. If the adapter
    // trimmed as well there would be two spellings of one rule, and the two
    // would eventually disagree — the same posture `domain` already takes.
    const padded = `   ${OVERVIEW}   `;
    const record = toNormalizedManualRecord(base({ description: padded }));
    expect(record.account?.description).toBe(padded);
  });

  it('is accepted by validation rather than refused as an unknown field', () => {
    expect(() => validateManualInput(base({ description: OVERVIEW }))).not.toThrow();
  });

  it('absence is absence: no description means null, not an empty string', () => {
    const record = toNormalizedManualRecord(base());
    // Null means unknown. An empty string would be a positive claim that the
    // company has no description, and would overwrite a real one on re-import.
    expect(record.account?.description ?? null).toBeNull();
  });

  it('the destination the engine proposes is the destination that gets written', () => {
    // This is the assertion that would have caught the original defect. It ties
    // the three vocabularies together: the registry key a tenant approves, the
    // canonical column LI-2 is allowed to write, and the adapter field in
    // between. Any one of the three going missing breaks it.
    const registryKey = CANONICAL_FIELDS.find((f) => f.key === 'description');
    expect(registryKey).toBeDefined();
    expect(registryKey!.entity).toBe('company');
    expect(ACCOUNT_ATTRIBUTE_COLUMNS).toContain(registryKey!.column);

    const record = toNormalizedManualRecord(base({ description: OVERVIEW }));
    expect(record.account?.[registryKey!.column as 'description']).toBe(OVERVIEW);
  });
});

/* ── 2. positional outcomes ──────────────────────────────── */

/**
 * There is no separate gate module to double — `resolveLeadIngestionGate` is
 * defined inside the orchestrator and reads `evaluateFeatureFlag`. So the
 * tenant gate is steered the way the real code resolves it, through the flag
 * service, and the identity collaborators below are doubled so no database is
 * required. `ingestLeadBatch`, the adapters and the loop are all REAL — the
 * correspondence between input and output is the thing under test, and a
 * doubled loop would prove nothing about it.
 */
function loadOrchestrator(
  opts: {
    flagEnabled?: boolean;
    /** Make the source-contribution write report failure, as it does with no database. */
    contributionFails?: boolean;
    /** Make identity reconciliation REJECT, which the orchestrator must absorb. */
    reconciliationRejects?: boolean;
  } = {},
) {
  jest.resetModules();
  process.env.ENABLE_LEAD_INGESTION = 'true';

  jest.doMock('../../services/featureFlagService', () => ({
    evaluateFeatureFlag: jest.fn(async () => ({
      enabled: opts.flagEnabled !== false,
      reason: 'test',
    })),
  }));
  jest.doMock('../../services/prospectIdentity/ingestionBoundary', () => ({
    ingestSourceRecord: jest.fn(async () => ({
      sourceRecordId: 'sr-1', outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [],
    })),
  }));
  jest.doMock('../../services/identityResolutionService', () => ({
    resolveUnifiedPerson: jest.fn(async () => ({
      unifiedPersonId: 'person-1', matchedBy: 'email', created: false,
    })),
  }));
  jest.doMock('../../services/prospectIdentity/accountResolution', () => ({
    resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
    attachPersonToAccount: jest.fn(async () => undefined),
  }));
  jest.doMock('../../services/prospectIdentity/prospectResolution', () => ({
    resolveOrCreateProspect: jest.fn(async () => ({
      organizationId: ORG, prospectId: 'prospect-1', subjectId: 'subject-1',
      outcome: 'created', externalLeadKey: 'K1', reason: 'created',
    })),
  }));
  jest.doMock('../../services/prospectIdentity/personDuplicates', () => ({
    detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
  }));
  jest.doMock('../../services/leadIntelligence/durableLeadIntelligenceSink', () => ({
    durableLeadIntelligenceSink: {
      emit: jest.fn(async () => ({
        status: 'persisted', leadId: 'lead-1', reason: null, warnings: [], error: null,
      })),
    },
  }));

  // PI-LDB-6 (diagnosed 2026-11-04). The two REMAINING collaborators on the
  // success path. Without these two doubles the promise in the docblock above —
  // "no database is required" — was simply false: `recordPiIngestionContribution`
  // (orchestrator.ts:513) and `reconcileVerifiedPersonIdentities`
  // (orchestrator.ts:538-539, behind a dynamic import) both reach PostgREST for
  // real. Against the absent local endpoint `.env.test` names, supabase-js
  // retries each failed GET four times with 1s/2s/4s backoff — ~7.2s per VALID
  // record, and the cost is linear in the number of valid records because an
  // invalid one takes an early `continue` long before these lines. Five valid
  // records cost ~36s and broke the 30s timeout; the partly-invalid sibling
  // below has only three valid records and came in under it. That, and nothing
  // about the assertions, was the whole of the asymmetry between them.
  //
  // `piProspectCandidateKeys` is deliberately kept REAL through `requireActual`,
  // and only the I/O function is replaced. It is a pure function, it runs at
  // orchestrator.ts:379 BEFORE the success path, and the `externalLeadKey`,
  // `namespacedExternalLeadKey` and `provenance` it returns are handed to
  // `resolveOrCreateProspect` and to `ingestSourceRecord`. A hand-written double
  // of it that got that shape even slightly wrong would fail every record early,
  // and this suite would go green — and fast — for entirely the wrong reason.
  jest.doMock('../../services/prospectProvenance/ingestion/piIngestionContribution', () => ({
    ...jest.requireActual<typeof import('../../services/prospectProvenance/ingestion/piIngestionContribution')>(
      '../../services/prospectProvenance/ingestion/piIngestionContribution',
    ),
    // The real helper absorbs a writer failure internally and RETURNS this
    // shape (recordContribution.ts:25-28); it does not throw. The double says
    // the same thing, so the double cannot be more forgiving than production.
    recordPiIngestionContribution: jest.fn(async () => (opts.contributionFails
      ? { status: 'error', code: 'threw', message: 'contribution writer unavailable' }
      : { status: 'inserted', id: 'contribution-1', role: 'originating', roleDowngraded: false })),
  }));
  jest.doMock('../../services/prospectProvenance/identityReconciliation', () => ({
    ...jest.requireActual<typeof import('../../services/prospectProvenance/identityReconciliation')>(
      '../../services/prospectProvenance/identityReconciliation',
    ),
    reconcileVerifiedPersonIdentities: jest.fn(async () => {
      // This one really can reject, and orchestrator.ts:536-541 wraps it in a
      // fail-open try/catch. The test below holds that guard in place.
      if (opts.reconciliationRejects) throw new Error('identity_claims unavailable');
      return [];
    }),
  }));

  // The package INDEX, not the orchestrator module: `registry.ts` ships empty
  // and `registerBuiltInLeadSources()` lives in the index, so importing the
  // orchestrator alone leaves manual/crm/csv unregistered and every record
  // fails `unsupported_source`.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../services/leadIngestion') as typeof import('../../services/leadIngestion');
  pkg.registerBuiltInLeadSources();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../services/leadIngestion/orchestrator') as typeof import('../../services/leadIngestion/orchestrator');
}

describe('PI-LDB-6 · batch outcomes are positional', () => {
  const IDS = ['A', 'B', 'C', 'D', 'E'];
  const rec = (id: string, over: Record<string, unknown> = {}) => ({
    organizationId: ORG, referenceId: id, email: `${id.toLowerCase()}@x.example`, ...over,
  });

  afterEach(() => { jest.resetModules(); });

  it('returns exactly one outcome per record, in the input order', async () => {
    const { ingestLeadBatch } = loadOrchestrator();
    const result = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: IDS.map((id) => rec(id)),
    } as never);

    expect(result.outcomes).toHaveLength(IDS.length);
    // `total` must equal the array length too: a client sizing its retry set
    // from `total` while indexing into `outcomes` would read off the end.
    expect(result.total).toBe(result.outcomes.length);
    expect(result.succeeded + result.failed).toBe(result.outcomes.length);
    // And every record must actually SUCCEED, as a number rather than as an
    // implication of the sum above: `succeeded + failed === outcomes.length`
    // holds just as well when all five FAIL, so on its own it cannot tell a
    // working batch from a mass failure. A change that doubles a collaborator
    // and accidentally makes every record fail early would otherwise leave this
    // test green — and fast — for entirely the wrong reason.
    expect(result.succeeded).toBe(IDS.length);
    expect(result.failed).toBe(0);
    // Order is the contract, so assert the identifiers came back in order.
    expect(result.outcomes.map((o) => o.externalId)).toEqual(IDS);
  });

  it('keeps the correspondence when records FAIL in the middle', async () => {
    // The interesting case. A failing record takes an early `continue`, and
    // every one of those paths must still push exactly one outcome — otherwise
    // each later index shifts by one and a retry re-imports the wrong rows.
    const { ingestLeadBatch } = loadOrchestrator();
    const result = await ingestLeadBatch({
      organizationId: ORG,
      source: 'manual',
      records: [
        rec('A'),
        rec('B', { email: 'not-an-email' }),
        rec('C'),
        rec('D', { metadata: { password: 'hunter2' } }),
        rec('E'),
      ],
    } as never);

    expect(result.outcomes).toHaveLength(5);
    expect(result.outcomes[1].ok).toBe(false);
    expect(result.outcomes[3].ok).toBe(false);
    // The surviving records must be UNSHIFTED — this is the assertion a
    // reordering refactor would break.
    expect(result.outcomes[0].ok).toBe(true);
    expect(result.outcomes[2].ok).toBe(true);
    expect(result.outcomes[4].ok).toBe(true);
  });

  it('a refused tenant still returns one outcome per record', async () => {
    const { ingestLeadBatch } = loadOrchestrator({ flagEnabled: false });
    const result = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: IDS.map((id) => rec(id)),
    } as never);

    // The batch is refused before any adapter runs, and a client indexing by
    // position must still be able to retry every row.
    expect(result.outcomes).toHaveLength(IDS.length);
    expect(result.failed).toBe(IDS.length);
    expect(result.outcomes.every((o) => !o.ok)).toBe(true);
  });

  /**
   * Both side effects doubled in `loadOrchestrator` are ADVISORY: the person,
   * the employer, the canonical Prospect and the evidence are all durable
   * before either one runs, so neither may turn a good record into a failed
   * one. Until 2026-11-04 this suite proved that only by ACCIDENT — both
   * collaborators genuinely were failing, against a database that is not
   * there, at ~7.2s of retry per record. Proving it on purpose costs
   * milliseconds, names which collaborator is under test, and keeps the
   * property once the doubles make the failure stop happening by itself.
   */
  it('a failed source-contribution write does not fail the record', async () => {
    const { ingestLeadBatch } = loadOrchestrator({ contributionFails: true });
    const result = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(true);
    expect(result.succeeded).toBe(1);
  });

  it('a rejected identity reconciliation does not fail the record', async () => {
    const { ingestLeadBatch } = loadOrchestrator({ reconciliationRejects: true });
    const result = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].ok).toBe(true);
    expect(result.succeeded).toBe(1);
  });

  it('an unsupported source fails one-for-one, not as a single error', async () => {
    const { ingestLeadBatch } = loadOrchestrator();
    const result = await ingestLeadBatch({
      organizationId: ORG, source: 'no_such_source', records: IDS.map((id) => rec(id)),
    } as never);

    expect(result.outcomes).toHaveLength(IDS.length);
    expect(result.outcomes.every((o) => !o.ok)).toBe(true);
  });
});
