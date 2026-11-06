/**
 * PI-LDB · Prompt 2 / Agent B — BATCH PROJECTION COUNTERS.
 *
 * The question under test is narrow and arithmetic: do `projected` and
 * `notProjected` on `IngestionBatchResult` describe the records that actually
 * ended up in each category, for every shape a batch can take?
 *
 * ─── THE INTENDED SEMANTICS, AS THE CODE STATES THEM ──────────────────────
 * `contracts.ts:276-288` is explicit, and the two counters are NOT a partition
 * of the batch:
 *
 *   succeeded      — records that INGESTED. Projection-blind by design.
 *   projected      — "Of the ingested records, how many reached the store the
 *                     Lead Database reads" → `leadProjection.status === 'persisted'`.
 *   notProjected   — "Ingested records whose projection failed or is
 *                     unconfirmed. Excludes legitimate skips."
 *                     → `needsAttention` = failed | pending_reconciliation.
 *
 * `skipped` is therefore in NEITHER counter, deliberately: `needsAttention`
 * (projectionResult.ts:490-497) excludes it because there was no prospect to
 * list, and warning about it "would train operators to ignore the warning that
 * matters". A record rejected BEFORE projection is in neither counter either,
 * because it never ingested and carries no `leadProjection` at all.
 *
 * ─── THE RECONCILIATION IDENTITY ──────────────────────────────────────────
 *   (1)  total      === succeeded + failed
 *   (2)  total      === outcomes.length
 *   (3)  succeeded  === projected + notProjected + skippedProjections
 *   (4)  projected and notProjected are DISJOINT sets of outcome indexes
 *   (5)  every outcome with `ok === false` carries NO `leadProjection`
 *   (6)  every outcome with `ok === true` carries EXACTLY ONE `leadProjection`
 *
 * (3) is the load-bearing one: it is what makes "ingested but invisible"
 * computable, and it only holds because of (5) and (6). (5) and (6) are not
 * documented anywhere, so they are asserted here — if a future change attaches
 * a projection verdict to a rejected record, (3) breaks silently and
 * `succeeded === total` once again becomes the only number anyone reads.
 *
 * ─── WHAT IS REAL AND WHAT IS DOUBLED ────────────────────────────────────
 * REAL: `ingestLeadBatch`, its loop, the adapter registry, the manual adapter,
 * `validateNormalizedRecord`, the tenant/source guards, `needsAttention`,
 * `isProjected`, the projection-status constructors, `ingestCanonicalLead` and
 * `buildAttributionContract`. The counting code is the subject, so none of it
 * is doubled.
 *
 * DOUBLED (no database is available to a unit test): identity resolution,
 * account resolution, prospect resolution, the provenance boundary, duplicate
 * detection, the feature-flag service, the PI contribution writer, identity
 * reconciliation, and `durableLeadIntelligenceSink.emit` — which is doubled
 * precisely so each of the four projection statuses can be produced on demand.
 * The double shape is copied from `piLdbDescriptionAndBatchOrder.test.ts`,
 * which established it, rather than invented again here.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';

type Verdict = {
  status: 'persisted' | 'skipped' | 'failed' | 'pending_reconciliation';
  leadId: string | null;
  reason: string | null;
  warnings: string[];
  error: string | null;
};

const v = {
  persisted: (id = 'lead-1'): Verdict => ({
    status: 'persisted', leadId: id, reason: null, warnings: [], error: null,
  }),
  failed: (reason = 'write_failed'): Verdict => ({
    status: 'failed', leadId: null, reason, warnings: [], error: 'boom',
  }),
  pending: (reason = 'unconfirmed_transport'): Verdict => ({
    status: 'pending_reconciliation', leadId: null, reason, warnings: [], error: null,
  }),
};

/** How many times the doubled sink was asked to emit, for the loaded module. */
let sinkCalls = 0;

/**
 * Whether `ingestCanonicalLead` should return WITHOUT emitting.
 *
 * A module-scope flag rather than a conditional `jest.doMock`, because a
 * `doMock` registration is NEVER undone: registering it inside
 * `if (opts.neverReachSink)` left `ingestCanonicalLead` doubled as a no-op for
 * every LATER test in the file, so six of them silently measured "the sink was
 * never reached" instead of the verdict they set up. The pipeline is doubled on
 * EVERY load now, and delegates to the real implementation unless this is set —
 * so what varies between tests is data, not the module registry.
 */
let neverReachSink = false;

function load(
  opts: {
    flagEnabled?: boolean;
    /**
     * FIFO queue of sink verdicts, one consumed per sink call. Records are
     * processed sequentially and a record rejected before projection never
     * reaches the sink, so position N here is the Nth record that got that far.
     * Exhausting the queue falls back to `persisted`, which is the shape that
     * would hide a counting bug — so the queues below are always long enough.
     */
    verdicts?: Verdict[];
    /** Make the sink THROW, carrying a classified verdict (or a bare Error). */
    sinkThrows?: { carrying?: Verdict } | null;
    /** Names whose prospect resolution yields a NULL prospectId → `skipped`. */
    noProspectFor?: string[];
    /** Double `ingestCanonicalLead` so the sink is never reached at all. */
    neverReachSink?: boolean;
  } = {},
) {
  jest.resetModules();
  sinkCalls = 0;
  neverReachSink = opts.neverReachSink === true;
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
    // WS-1 returns a NULL prospectId for a record it cannot key, and the
    // orchestrator turns that into `skipped('no_prospect')`. Steered by
    // `fullName` because that is a field the resolver genuinely receives
    // (orchestrator.ts:380), so the double is driven by the real call shape.
    resolveOrCreateProspect: jest.fn(async (
      organizationId: string,
      input: { fullName?: string | null },
    ) => {
      const skip = (opts.noProspectFor ?? []).includes(input?.fullName ?? '');
      return {
        organizationId,
        prospectId: skip ? null : 'prospect-1',
        subjectId: 'subject-1',
        outcome: skip ? 'insufficient_evidence' : 'created',
        externalLeadKey: 'K1',
        reason: skip ? 'insufficient_evidence' : 'created',
      };
    }),
  }));
  jest.doMock('../../services/prospectIdentity/personDuplicates', () => ({
    detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
  }));

  const queue = [...(opts.verdicts ?? [])];
  jest.doMock('../../services/leadIntelligence/durableLeadIntelligenceSink', () => ({
    durableLeadIntelligenceSink: {
      emit: jest.fn(async () => {
        sinkCalls += 1;
        if (opts.sinkThrows) {
          const e = new Error('sink refused the write') as Error & { result?: Verdict };
          // The PROTECTED shape: the sink throws and carries its classified
          // verdict on `.result`, which `projectionFailureFrom` unwraps
          // structurally. Nothing here changes that contract.
          if (opts.sinkThrows.carrying) e.result = opts.sinkThrows.carrying;
          throw e;
        }
        return queue.shift() ?? v.persisted();
      }),
    },
  }));

  // Agent A's territory, included here only because of what it does to the
  // COUNTERS: a pipeline that returns without emitting must land in
  // `notProjected`, never be absent from both counters as a silent success.
  // Registered unconditionally and gated on `neverReachSink` — see that
  // variable's comment for the leak this avoids.
  jest.doMock('../../../lib/leadIntelligence/ingest', () => {
    const actual = jest.requireActual<typeof import('../../../lib/leadIntelligence/ingest')>(
      '../../../lib/leadIntelligence/ingest',
    );
    return {
      ...actual,
      ingestCanonicalLead: jest.fn(async (
        ...args: Parameters<typeof actual.ingestCanonicalLead>
      ) => (neverReachSink ? undefined : actual.ingestCanonicalLead(...args))),
    };
  });

  jest.doMock('../../services/prospectProvenance/ingestion/piIngestionContribution', () => ({
    ...(jest.requireActual('../../services/prospectProvenance/ingestion/piIngestionContribution') as object),
    recordPiIngestionContribution: jest.fn(async () => ({
      status: 'inserted', id: 'contribution-1', role: 'originating', roleDowngraded: false,
    })),
  }));
  jest.doMock('../../services/prospectProvenance/identityReconciliation', () => ({
    ...(jest.requireActual('../../services/prospectProvenance/identityReconciliation') as object),
    reconcileVerifiedPersonIdentities: jest.fn(async () => []),
  }));

  // The package INDEX registers the built-in adapters; importing the
  // orchestrator alone leaves `manual` unregistered and every record fails
  // `unsupported_source` — a green-for-the-wrong-reason trap.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../services/leadIngestion') as typeof import('../../services/leadIngestion');
  pkg.registerBuiltInLeadSources();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../services/leadIngestion/orchestrator') as typeof import('../../services/leadIngestion/orchestrator');
}

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  referenceId: id,
  fullName: `Name ${id}`,
  email: `${id.toLowerCase()}@x.example`,
  ...over,
});

type Batch = Awaited<
  ReturnType<typeof import('../../services/leadIngestion/orchestrator').ingestLeadBatch>
>;

type Predicates = typeof import('../../../lib/leadIntelligence/projectionResult');

const predicates = (): Predicates =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../../lib/leadIntelligence/projectionResult') as Predicates;

/** Recount every category straight from `outcomes`, independently of the result. */
function recount(r: Batch) {
  const ok = r.outcomes.filter((o) => o.ok);
  const byStatus = (s: string) => ok.filter((o) => o.leadProjection?.status === s).length;
  return {
    ok: ok.length,
    persisted: byStatus('persisted'),
    skipped: byStatus('skipped'),
    failed: byStatus('failed'),
    pending: byStatus('pending_reconciliation'),
    withoutProjection: ok.filter((o) => o.leadProjection === undefined).length,
    rejectedWithProjection: r.outcomes.filter((o) => !o.ok && o.leadProjection !== undefined).length,
  };
}

/**
 * The six-part identity from the docblock, asserted on EVERY batch this suite
 * produces — including the two whole-batch refusals, where it must also hold.
 */
function assertReconciles(r: Batch) {
  const c = recount(r);
  expect(r.total).toBe(r.outcomes.length);                            // (2)
  expect(r.succeeded + r.failed).toBe(r.total);                       // (1)
  expect(r.succeeded).toBe(c.ok);
  expect(r.projected).toBe(c.persisted);
  expect(r.notProjected).toBe(c.failed + c.pending);
  expect(r.succeeded).toBe(r.projected + r.notProjected + c.skipped); // (3)
  expect(c.rejectedWithProjection).toBe(0);                           // (5)
  expect(c.withoutProjection).toBe(0);                                // (6)
  // (4) — disjointness by INDEX, not by count. Two counters that each returned
  // the same record would still satisfy the sums above if a third were missing.
  const { isProjected, needsAttention } = predicates();
  const pIdx = new Set<number>();
  const nIdx = new Set<number>();
  r.outcomes.forEach((o, i) => {
    if (!o.leadProjection) return;
    if (isProjected(o.leadProjection)) pIdx.add(i);
    if (needsAttention(o.leadProjection)) nIdx.add(i);
  });
  expect([...pIdx].filter((i) => nIdx.has(i))).toEqual([]);
  expect(pIdx.size).toBe(r.projected);
  expect(nIdx.size).toBe(r.notProjected);
  expect(pIdx.size + nIdx.size).toBeLessThanOrEqual(r.outcomes.length);
}

/**
 * `ResultsTable.tsx:121` verbatim. The screen recomputes the gap from
 * `outcomes` rather than reading the server's `notProjected` (see the suite's
 * last block for why that matters), so the headline is modelled from the same
 * inputs the component gets.
 */
function headline(r: Batch, transportError: string | null = null, aborted = false) {
  const { needsAttention } = predicates();
  const uiNotProjected = r.outcomes.filter(
    (o) => o.ok && o.leadProjection !== undefined && needsAttention(o.leadProjection),
  );
  return r.failed === 0 && uiNotProjected.length === 0 && !transportError && !aborted
    ? 'Import complete'
    : 'Import finished with problems';
}

afterEach(() => { jest.resetModules(); });

/* ── the intended semantics, stated as assertions ───────────────────────── */

describe('PI-LDB · counter semantics are the ones the contract states', () => {
  it('the status vocabulary is exactly four values, and `schema_not_applied` is a REASON', () => {
    const m = predicates();
    expect([...m.LEAD_PROJECTION_STATUSES]).toEqual(
      ['persisted', 'skipped', 'failed', 'pending_reconciliation'],
    );
    expect(m.failed('schema_not_applied').status).toBe('failed');
    expect(m.failed('schema_not_applied').reason).toBe('schema_not_applied');
  });

  it('`notProjected` is failed|pending, and a legitimate skip is in NEITHER counter', () => {
    const { isProjected, needsAttention, persisted, skipped, failed, pendingReconciliation } = predicates();
    expect([isProjected(persisted('x')), needsAttention(persisted('x'))]).toEqual([true, false]);
    expect([isProjected(skipped('no_prospect')), needsAttention(skipped('no_prospect'))])
      .toEqual([false, false]);
    expect([isProjected(failed('denied')), needsAttention(failed('denied'))]).toEqual([false, true]);
    expect([
      isProjected(pendingReconciliation('unconfirmed_transport')),
      needsAttention(pendingReconciliation('unconfirmed_transport')),
    ]).toEqual([false, true]);
  });
});

/* ── one combination per shape a batch can take ─────────────────────────── */

describe('PI-LDB · batch projection counters, per combination', () => {
  it('PERSISTED ONLY: projected === succeeded === total, notProjected 0', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.persisted(), v.persisted(), v.persisted()] });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B', 'C'].map((i) => rec(i)),
    } as never);

    expect(sinkCalls).toBe(3);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([3, 3, 0, 3, 0]);
    assertReconciles(r);
    expect(headline(r)).toBe('Import complete');
  });

  it('SKIPPED ONLY: in neither counter — and never counted as persisted', async () => {
    const names = ['A', 'B', 'C'].map((i) => `Name ${i}`);
    const { ingestLeadBatch } = load({ noProspectFor: names });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B', 'C'].map((i) => rec(i)),
    } as never);

    // The sink is never even reached: there is no prospect to project.
    expect(sinkCalls).toBe(0);
    expect(r.outcomes.every((o) => o.leadProjection?.status === 'skipped')).toBe(true);
    expect(r.outcomes.every((o) => o.leadProjection?.reason === 'no_prospect')).toBe(true);
    // VERIFICATION 4 — a valid skip is not a successful persisted projection.
    expect(r.projected).toBe(0);
    expect(r.outcomes.every((o) => o.leadProjection?.leadId === null)).toBe(true);
    // ...and not a warning either. Both counters zero; `succeeded` is 3.
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([3, 3, 0, 0, 0]);
    assertReconciles(r);
    // The screen says "complete", which is correct: nothing is missing.
    expect(headline(r)).toBe('Import complete');
  });

  it('FAILED projections: all three land in notProjected, none in projected', async () => {
    const { ingestLeadBatch } = load({
      verdicts: [v.failed('denied'), v.failed('invalid'), v.failed()],
    });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B', 'C'].map((i) => rec(i)),
    } as never);

    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([3, 3, 0, 0, 3]);
    assertReconciles(r);
    // VERIFICATION 6 — `succeeded === total` yet the batch is NOT fully
    // successful, and the screen must not claim it is.
    expect(r.succeeded).toBe(r.total);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('PENDING RECONCILIATION is not presented as complete persistence', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.pending(), v.pending('no_row_returned')] });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B'].map((i) => rec(i)),
    } as never);

    // VERIFICATION 5.
    expect(r.projected).toBe(0);
    expect(r.notProjected).toBe(2);
    expect(r.outcomes.every((o) => o.leadProjection?.leadId === null)).toBe(true);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('SCHEMA_NOT_APPLIED: counted as notProjected and the REASON survives to the UI', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.failed('schema_not_applied')] });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect([r.projected, r.notProjected]).toEqual([0, 1]);
    // `ResultsTable.tsx:225-227` keys its "retrying will not help" copy off
    // this exact reason string, so the counter alone is not enough.
    expect(r.outcomes[0].leadProjection).toMatchObject({
      status: 'failed', reason: 'schema_not_applied',
    });
    assertReconciles(r);
  });

  it('SINK NEVER REACHED: pessimistic pending, so it is counted, not silently dropped', async () => {
    const { ingestLeadBatch } = load({ neverReachSink: true });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect(sinkCalls).toBe(0);
    expect(r.outcomes[0].leadProjection).toMatchObject({
      status: 'pending_reconciliation', reason: 'no_row_returned',
      // THE DISCRIMINATOR. Three sites return
      // `pendingReconciliation('no_row_returned')` and only the orchestrator's
      // sink-not-reached fallback (orchestrator.ts:667-668) passes a second
      // argument, so this string is what tells "the sink was never called"
      // apart from a genuinely ambiguous write at `leadIntelligencePorts.ts:93`
      // or `leadIntelligenceRepository.ts:165`. Both belong in `notProjected`,
      // but an operator triaging the counter needs to know which.
      error: 'the durable sink was not reached',
    });
    expect([r.projected, r.notProjected]).toEqual([0, 1]);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('a THROWING sink carrying a verdict is counted by that verdict, not flattened', async () => {
    const { ingestLeadBatch } = load({ sinkThrows: { carrying: v.failed('schema_not_applied') } });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect(r.outcomes[0].leadProjection).toMatchObject({
      status: 'failed', reason: 'schema_not_applied',
    });
    expect([r.projected, r.notProjected]).toEqual([0, 1]);
    assertReconciles(r);
  });

  it('a THROWING sink carrying NOTHING degrades to failed/write_failed, still counted', async () => {
    const { ingestLeadBatch } = load({ sinkThrows: {} });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [rec('A')],
    } as never);

    expect(r.outcomes[0].leadProjection).toMatchObject({ status: 'failed', reason: 'write_failed' });
    expect([r.projected, r.notProjected]).toEqual([0, 1]);
    assertReconciles(r);
  });

  it('MIXED: one of each status, plus one record rejected before projection', async () => {
    // Record order: A persisted · B skipped (no prospect) · C failed ·
    // D pending · E rejected before projection.
    //
    // E has no `referenceId`, so `validateManualInput` refuses it inside
    // `translate` and the orchestrator records `normalization_failed`. An
    // earlier draft used a record with a name and no email, on the assumption
    // that a person needs a contact anchor — but `toNormalizedManualRecord`
    // DERIVES a provider identifier from the reference, so that record was
    // perfectly valid and quietly consumed a fourth verdict. The `sinkCalls`
    // assertion is what caught it, which is why it is here.
    //
    // B never reaches the sink and E never reaches the orchestrator's loop
    // body, so the verdict queue is consumed by A, C, D in that order.
    const { ingestLeadBatch } = load({
      noProspectFor: ['Name B'],
      verdicts: [v.persisted(), v.failed('denied'), v.pending()],
    });
    const r = await ingestLeadBatch({
      organizationId: ORG,
      source: 'manual',
      records: [
        rec('A'),
        rec('B'),
        rec('C'),
        rec('D'),
        { organizationId: ORG, fullName: 'Name E' },
      ],
    } as never);

    expect(sinkCalls).toBe(3);
    expect(r.outcomes.map((o) => (o.ok ? o.leadProjection?.status : `rejected:${o.rejection}`)))
      .toEqual([
        'persisted',
        'skipped',
        'failed',
        'pending_reconciliation',
        'rejected:normalization_failed',
      ]);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([5, 4, 1, 1, 2]);
    // The "neither counter" bucket is exactly the one skip.
    expect(r.succeeded - r.projected - r.notProjected).toBe(1);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('PARTIAL FAILURE cannot make the whole batch look fully successful', async () => {
    // VERIFICATION 6, in its sharpest form: two records land, one does not,
    // and `succeeded` is projection-blind for all three.
    const { ingestLeadBatch } = load({
      verdicts: [v.persisted(), v.failed('denied'), v.persisted()],
    });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B', 'C'].map((i) => rec(i)),
    } as never);

    expect(r.succeeded).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.projected).toBe(2);
    expect(r.notProjected).toBe(1);
    // There is no reading of the result in which it is fully successful.
    expect(r.projected).not.toBe(r.total);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('EMPTY BATCH: every counter zero, and no outcome', async () => {
    const { ingestLeadBatch } = load();
    const r = await ingestLeadBatch({ organizationId: ORG, source: 'manual', records: [] } as never);

    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([0, 0, 0, 0, 0]);
    expect(r.outcomes).toEqual([]);
    assertReconciles(r);
    expect(headline(r)).toBe('Import complete');
  });

  it('IDEMPOTENT RE-INGESTION: each batch counts its own records once, never twice', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.persisted('lead-1'), v.persisted('lead-1')] });
    const input = { organizationId: ORG, source: 'manual', records: [rec('A')] };

    const first = await ingestLeadBatch(input as never);
    const second = await ingestLeadBatch(input as never);

    // The same prospect and the same lead id both times — the upsert is keyed
    // on (company_id, dedupe_key), so a replay re-persists the SAME row.
    expect(first.outcomes[0].leadProjection?.leadId).toBe('lead-1');
    expect(second.outcomes[0].leadProjection?.leadId).toBe('lead-1');
    // VERIFICATION 2 — one record, one count, per batch. A counter that
    // accumulated across calls would read 2 on the second batch.
    expect([first.projected, first.notProjected]).toEqual([1, 0]);
    expect([second.projected, second.notProjected]).toEqual([1, 0]);
    assertReconciles(first);
    assertReconciles(second);
  });

  it('ONE RECORD IS NEVER COUNTED TWICE, even across a four-status batch', async () => {
    const { ingestLeadBatch } = load({
      noProspectFor: ['Name B'],
      verdicts: [v.persisted(), v.failed('denied'), v.pending(), v.persisted()],
    });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: ['A', 'B', 'C', 'D', 'E'].map((i) => rec(i)),
    } as never);

    // `assertReconciles` proves disjointness by index; this states the total.
    expect(r.projected + r.notProjected).toBeLessThanOrEqual(r.outcomes.length);
    expect(r.projected + r.notProjected).toBe(4);
    expect(r.succeeded).toBe(5);
    assertReconciles(r);
  });
});

/* ── records rejected before projection ─────────────────────────────────── */

describe('PI-LDB · records rejected before projection are in neither counter', () => {
  it('NORMALISATION/VALIDATION failure: no projection verdict, no count', async () => {
    const { ingestLeadBatch } = load();
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: [{}, { organizationId: ORG }],
    } as never);

    expect(sinkCalls).toBe(0);
    expect(r.outcomes.every((o) => !o.ok)).toBe(true);
    expect(r.outcomes.every((o) => o.leadProjection === undefined)).toBe(true);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([2, 0, 2, 0, 0]);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  /**
   * The two mismatch guards cannot be reached through a BUILT-IN adapter.
   * `manualAdapter.translate` (manualAdapter.ts:321-324) does
   * `{ ...raw, organizationId }` — it OVERWRITES whatever tenant the record
   * claimed with the batch's, so a record naming another tenant is rewritten,
   * not refused, and `translated.normalized.source` is the adapter's own
   * constant. Both guards are therefore defence in depth against a future or
   * third-party adapter, and the only honest way to exercise them is to
   * register an adapter that misbehaves in exactly that way. The ADAPTER is
   * the fake here; the orchestrator, its loop, both guards and the counting
   * are all real, and they are what is under test.
   */
  const misbehaving = (source: string, mutate: (r: Record<string, unknown>) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manual = require('../../services/leadIngestion/adapters/manualAdapter') as
      typeof import('../../services/leadIngestion/adapters/manualAdapter');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const registry = require('../../services/leadIngestion/registry') as
      typeof import('../../services/leadIngestion/registry');
    registry.registerLeadSourceAdapter({
      source,
      label: source,
      capabilities: ['single_record_fetch'],
      translate: (raw: Record<string, unknown>, organizationId: string) => {
        // `raw` is already `Record<string, unknown>`, which IS an object type;
        // spreading `never` is a TS2698. The cast the call actually needs is the
        // one on the whole argument, which is still here.
        const normalized = manual.toNormalizedManualRecord({
          ...raw, organizationId,
        } as never);
        // The manual translate stamps `source: 'manual'`. An adapter whose
        // normalized source did not match its own key would trip the SOURCE
        // guard on every record, which is the opposite of a controlled
        // experiment — so the honest baseline is set here and only the one
        // record under test is then broken by `mutate`.
        (normalized as unknown as Record<string, unknown>).source = source;
        mutate(normalized as unknown as Record<string, unknown>);
        return { raw, normalized };
      },
    });
  };

  it('TENANT MISMATCH: refused before any write, and in neither counter', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.persisted()] });
    misbehaving('b_tenant_liar', (n) => {
      if (n.externalId === 'A') n.organizationId = OTHER_ORG;
    });

    const r = await ingestLeadBatch({
      organizationId: ORG,
      source: 'b_tenant_liar',
      records: [rec('A'), rec('B')],
    } as never);

    // Record A's adapter output named another tenant. The batch's tenant is
    // authoritative, so it is refused rather than written into the tenant it
    // named — and it carries no projection verdict, so neither counter sees it.
    expect(r.outcomes[0].ok).toBe(false);
    expect(r.outcomes[0].rejection).toBe('validation_failed');
    expect(r.outcomes[0].error).toContain(OTHER_ORG);
    expect(r.outcomes[0].leadProjection).toBeUndefined();
    expect(r.outcomes[1].ok).toBe(true);
    // Exactly one record reached the sink — the mismatch wrote nothing.
    expect(sinkCalls).toBe(1);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([2, 1, 1, 1, 0]);
    assertReconciles(r);
  });

  it('SOURCE MISMATCH: refused before any write, and in neither counter', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.persisted()] });
    misbehaving('b_source_liar', (n) => {
      if (n.externalId === 'A') n.source = 'some_other_provider';
    });

    const r = await ingestLeadBatch({
      organizationId: ORG,
      source: 'b_source_liar',
      records: [rec('A'), rec('B')],
    } as never);

    expect(r.outcomes[0].ok).toBe(false);
    expect(r.outcomes[0].rejection).toBe('validation_failed');
    expect(r.outcomes[0].error).toContain('some_other_provider');
    expect(r.outcomes[0].leadProjection).toBeUndefined();
    expect(sinkCalls).toBe(1);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([2, 1, 1, 1, 0]);
    assertReconciles(r);
  });

  it('a THROWING adapter is a normalization failure, and is in neither counter', async () => {
    const { ingestLeadBatch } = load({ verdicts: [v.persisted()] });
    misbehaving('b_thrower', (n) => {
      if (n.externalId === 'A') throw new Error('adapter blew up');
    });

    const r = await ingestLeadBatch({
      organizationId: ORG,
      source: 'b_thrower',
      records: [rec('A'), rec('B')],
    } as never);

    expect(r.outcomes[0].rejection).toBe('normalization_failed');
    expect(r.outcomes[0].leadProjection).toBeUndefined();
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([2, 1, 1, 1, 0]);
    assertReconciles(r);
  });

  it('the source guard `continue`s BEFORE the record is ingested at all', async () => {
    // The guard's position is the reason a refused record can carry no verdict,
    // so it is asserted directly rather than inferred from the counts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/leadIngestion/orchestrator.ts'),
      'utf8',
    );
    const guard = src.indexOf("returned source '");
    const call = src.indexOf('await ingestNormalizedRecord(translated');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
    expect(src.slice(guard, call)).toContain('continue;');
  });
});

/* ── the two whole-batch refusals ───────────────────────────────────────── */

describe('PI-LDB · the two early-return whole-batch refusals', () => {
  const IDS = ['A', 'B', 'C'];

  it('TENANT GATE REFUSED: both counters are hardcoded 0 — and 0 is CORRECT', async () => {
    const { ingestLeadBatch } = load({ flagEnabled: false });
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'manual', records: IDS.map((i) => rec(i)),
    } as never);

    // The literals at orchestrator.ts:733-734 are not a shortcut that could
    // drift: NOTHING ingested, so there are no ingested records for either
    // counter to be "of". Every outcome is a rejection with no projection
    // verdict, which is precisely what makes `succeeded === projected +
    // notProjected + skipped` hold as 0 === 0 + 0 + 0.
    expect(sinkCalls).toBe(0);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([3, 0, 3, 0, 0]);
    expect(r.outcomes.every((o) => !o.ok && o.leadProjection === undefined)).toBe(true);
    expect(r.outcomes.every((o) => o.rejection === 'ingestion_disabled')).toBe(true);
    assertReconciles(r);
    // The honesty that matters: `failed === total`, so the screen cannot say
    // "complete" on the back of the two zeroed counters.
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('UNSUPPORTED SOURCE: same shape, same reason the zeros are right', async () => {
    const { ingestLeadBatch } = load();
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'no_such_source', records: IDS.map((i) => rec(i)),
    } as never);

    expect(sinkCalls).toBe(0);
    expect([r.total, r.succeeded, r.failed, r.projected, r.notProjected]).toEqual([3, 0, 3, 0, 0]);
    expect(r.outcomes.every((o) => !o.ok && o.leadProjection === undefined)).toBe(true);
    expect(r.outcomes.every((o) => o.rejection === 'unsupported_source')).toBe(true);
    assertReconciles(r);
    expect(headline(r)).toBe('Import finished with problems');
  });

  it('the refusals report `source` as REQUESTED, so a client can label the failure', async () => {
    const { ingestLeadBatch } = load();
    const r = await ingestLeadBatch({
      organizationId: ORG, source: 'no_such_source', records: [rec('A')],
    } as never);
    expect(r.source).toBe('no_such_source');
    expect(r.organizationId).toBe(ORG);
  });
});

/* ── where the counters actually go ─────────────────────────────────────── */

describe('PI-LDB · counter DELIVERY and consumers', () => {
  const read = (p: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path') as typeof import('path');
    return fs.readFileSync(path.join(__dirname, '../../..', p), 'utf8');
  };

  /**
   * FINDING B-1, now FIXED — and this is the lock that keeps it fixed.
   *
   * `contracts.ts:276-285` says these two counts exist so that a batch in
   * which not one row reached `lead_intelligence` cannot answer
   * `succeeded === total` and nothing else. All three HTTP routes used to
   * serialise exactly `{source,total,succeeded,failed,outcomes}` — the
   * pre-fix shape — so the counters were computed and then discarded at the
   * boundary, leaving every non-browser client and the durable
   * `lead.ingestion_batch` telemetry event with no way to see the gap. The
   * interactive import screen escaped it only because `ResultsTable` RECOMPUTES
   * the gap from `outcomes`, which no API client does.
   *
   * Both counters are now delivered in both places. Asserting a count of two
   * per route, rather than mere presence, is what makes dropping either one of
   * the two sites fail here.
   */
  it.each([
    'pages/api/lead-ingestion/csv.ts',
    'pages/api/lead-ingestion/crm.ts',
    'pages/api/lead-ingestion/manual.ts',
  ])('%s delivers `projected`/`notProjected` in both the 200 body and the telemetry', (route) => {
    const src = read(route);
    expect(src).toContain('succeeded: result.succeeded');
    expect(src).toContain('failed: result.failed');
    // Twice each: once in the telemetry metadata, once in the 200 body.
    expect(src.match(/projected: result\.projected/g)).toHaveLength(2);
    expect(src.match(/notProjected: result\.notProjected/g)).toHaveLength(2);
    expect(src).toContain("type: 'lead.ingestion_batch'");
  });

  it('the UI still RECOMPUTES the gap rather than consuming the delivered counters', () => {
    // The three routes now forward both counters (test above), but no CONSUMER
    // reads them yet: `ResultsTable.tsx:81-83` recomputes the gap from
    // `outcomes` with the shared `needsAttention` predicate, which is why the
    // screen was honest even before B-1 was fixed. Pinned deliberately — the
    // delivery fix is additive and changed no consumer, so if a later change
    // switches the screen onto the server's numbers, that happens here, on
    // purpose, and not as a silent coupling.
    const ui = read('components/prospects/import/ResultsTable.tsx');
    expect(ui).toContain('needsAttention(o.leadProjection)');
    expect(ui).toContain('const notProjected = useMemo(');
    // The component's props do not include either counter.
    expect(ui).not.toContain('projected: number');
    const chunks = read('lib/prospects/import/submitChunks.ts');
    expect(chunks).not.toContain('projected');
  });

  it('`discoveryExecutor` reads the PROJECTION counters too, not only `succeeded`', () => {
    // RETARGETED (Prompt 2A). This test used to assert
    // `expect(src).not.toContain('result.projected')` — it PINNED the
    // projection-blindness as correct, and a test that defends a defect is
    // worse than no test, which is the lesson `projectionResult.ts` records
    // about an earlier pin on `08006`.
    //
    // `ingestedThisPage = result.succeeded` STAYS: `results_ingested` is
    // defined by its own migration as "what the ingestion boundary accepted",
    // and a record whose projection failed really did ingest. What was missing
    // is that the projection-blind number was the ONLY number read, so a page
    // whose projections all failed closed the execution as
    // `completed`/`discovered`. The executor now folds `projected` and
    // `notProjected` across pages and refuses to claim a bare `discovered`
    // when the read model does not support it.
    const src = read('backend/services/prospectDiscovery/discoveryExecutor.ts');
    expect(src).toContain('ingestedThisPage = result.succeeded');
    expect(src).toContain('projection.projected += result.projected');
    expect(src).toContain('projection.attention += result.notProjected');
    // The claim itself, and the pessimistic default behind it.
    expect(src).toContain("'discovered_not_projected'");
    expect(src).toContain("'discovered_partially_projected'");
    expect(src).toContain("outcome = 'discovered_projection_unreported'");
    expect(src).toContain('projection.reported = false');
    // Reported to the caller, so the route can forward it.
    expect(src).toContain('readonly resultsProjected: number | null');
    const route = read('pages/api/prospect-sources/discovery.ts');
    expect(route).toContain('resultsProjected: run.resultsProjected');
    expect(route).toContain('resultsNeedingAttention: run.resultsNeedingAttention');
  });
});
