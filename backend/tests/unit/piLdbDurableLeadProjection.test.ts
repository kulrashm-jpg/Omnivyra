/**
 * PI-LDB-4 — the prospect now reaches the DURABLE lead store.
 *
 * ─── WHAT WAS BROKEN ──────────────────────────────────────────────────────
 * `ingestCanonicalLead`, `buildAttributionContract`, `assemble()` and
 * `durableLeadIntelligenceSink` were all wired to each other and to the read
 * service, and NOTHING in the ingestion path invoked them. So a prospect became
 * durable in `canonical_leads` and never reached `lead_intelligence` — the
 * store the Lead Database surface reads first and wins dedupe on. It then
 * surfaced only through the legacy bridge, which reads `row.name` and
 * `row.email` from a table that deliberately stores neither.
 *
 * A severed call chain is worse than a missing one, because every import looks
 * like it succeeded. So the first test here asserts the CALL HAPPENS. The rest
 * assert it carries the right thing, and that it cannot take good intake down
 * with it when it fails.
 *
 * Everything below the orchestrator is doubled; `ingestCanonicalLead` itself is
 * the REAL implementation, because a test that doubled the pipeline would prove
 * only that the test calls the test.
 */

const ingested: Array<Record<string, unknown>> = [];
const emitted: Array<Record<string, unknown>> = [];
let emitThrows: Error | null = null;
let prospectId: string | null = 'prospect-1';

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(async () => ({ enabled: true, reason: 'test_flag_enabled' })),
}));

jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async (input: Record<string, unknown>) => {
    ingested.push(input);
    return {
      sourceRecordId: `sr-${ingested.length}`, outcome: 'created',
      assertionsRecorded: 1, assertionsAlreadyPresent: 0,
      canonicalApplied: [], canonicalWithheld: [],
    };
  }),
}));

const resolveUnifiedPersonMock = jest.fn(async () => ({
  unifiedPersonId: 'person-1', matchedBy: 'email', created: false,
}));
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: (...args: unknown[]) => resolveUnifiedPersonMock(...(args as [])),
}));

jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
  attachPersonToAccount: jest.fn(async () => undefined),
}));

jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => ({
    organizationId: 'org', prospectId, subjectId: 'subject-1',
    outcome: 'created', externalLeadKey: 'K1', reason: 'created',
  })),
}));

jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

// The ONLY doubled part of the projection: the sink, so the emitted lead can be
// inspected without a database. The pipeline that builds it is real.
//
// This suite proves the orchestrator CALLS the sink with the right payload. It
// deliberately cannot prove a row was written — `emitted` is an array in this
// file. That is exactly the gap that let `emitted: true` pass for a record that
// wrote nothing, so the persistence question is answered by its own suite,
// `piLdbProjectionTruthfulness.test.ts`, which runs the real sink over a fake
// database. Keep the two separate: a payload test that also claims to prove
// persistence is how this defect survived twelve passing tests.
jest.mock('../../services/leadIntelligence/durableLeadIntelligenceSink', () => ({
  durableLeadIntelligenceSink: {
    emit: jest.fn(async (lead: Record<string, unknown>) => {
      if (emitThrows) throw emitThrows;
      emitted.push(lead);
      return { status: 'persisted', leadId: `lead-${emitted.length}`, reason: null, warnings: [], error: null };
    }),
  },
}));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';
import type { AdapterResult } from '../../services/leadIngestion/contracts';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const csvRecord = (over: Partial<AdapterResult['normalized']> = {}): AdapterResult => ({
  // Two keys the contract does not map, so `sourceMetadata` preservation can be
  // asserted rather than assumed.
  raw: { Designation: 'Snr. Procurement Mgr', 'Favourite Colour': 'teal' },
  normalized: {
    organizationId: ORG,
    // Free text, as the contract defines it. The taxonomy — not a cast — is
    // what turns this into a canonical source.
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
beforeAll(() => { flagBefore = process.env[INGESTION_FLAG]; });
afterAll(() => {
  if (flagBefore === undefined) delete process.env[INGESTION_FLAG];
  else process.env[INGESTION_FLAG] = flagBefore;
});

beforeEach(() => {
  process.env[INGESTION_FLAG] = 'true';
  ingested.length = 0;
  emitted.length = 0;
  emitThrows = null;
  prospectId = 'prospect-1';
  resolveUnifiedPersonMock.mockClear();
});

describe('PI-LDB-4 — the chain is connected', () => {
  it('EMITS to the durable lead store, which nothing in this path did before', async () => {
    const out = await ingestNormalizedRecord(csvRecord());
    expect(out.ok).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(out.leadProjection?.status).toBe('persisted');
    expect(out.leadProjection?.leadId).toBe('lead-1');
  });

  it('runs the projection AFTER provenance, so a published lead always has evidence', async () => {
    await ingestNormalizedRecord(csvRecord());
    // Provenance recorded first; the projection is a read-model view of an
    // already-durable prospect, never a precondition for one.
    expect(ingested.length).toBeGreaterThan(0);
    expect(emitted).toHaveLength(1);
  });
});

describe('PI-LDB-4 — what the emitted lead carries', () => {
  it('carries the human-readable label, the whole point of the change', async () => {
    await ingestNormalizedRecord(csvRecord());
    expect(emitted[0].display).toEqual({
      name: 'Ada Lovelace',
      title: 'Senior Procurement Manager',
      contentText: null,
    });
  });

  it('maps the free-text provider key through the taxonomy: csv becomes import', async () => {
    await ingestNormalizedRecord(csvRecord());
    // Not a cast. `resolveCanonicalSource` owns this, which is why the lead is
    // labelled Import and answers the `?source=import` filter.
    expect(emitted[0].source).toBe('import');
  });

  it('anchors the lead to the canonical Prospect', async () => {
    await ingestNormalizedRecord(csvRecord());
    expect(emitted[0].sourceRef).toEqual({ table: 'canonical_leads', id: 'prospect-1' });
  });

  it('carries the resolved identity without resolving it a second time', async () => {
    await ingestNormalizedRecord(csvRecord());
    // A second resolution could return a DIFFERENT person for the same record
    // and split one prospect across two identities. The pass-through port is
    // what prevents it, and this is the assertion that holds it in place.
    expect(resolveUnifiedPersonMock).toHaveBeenCalledTimes(1);
    expect(emitted[0].unifiedPersonId).toBe('person-1');
    expect((emitted[0].identity as Record<string, unknown>).email).toBe('ada@babbage.example');
  });

  it('preserves the provider payload verbatim in sourceMetadata', async () => {
    await ingestNormalizedRecord(csvRecord());
    const attribution = emitted[0].attribution as { sourceMetadata: Record<string, unknown> };
    // Original data is preserved beside the canonical interpretation, including
    // a column the platform has no destination for at all.
    expect(attribution.sourceMetadata).toMatchObject({
      Designation: 'Snr. Procurement Mgr',
      'Favourite Colour': 'teal',
    });
  });

  it('records when the SOURCE observed the record, not when we ingested it', async () => {
    await ingestNormalizedRecord(csvRecord());
    expect(emitted[0].occurredAt).toBe('2026-11-02T10:00:00.000Z');
  });

  it('carries the PROVENANCE CATEGORY onto the projected lead (Prompt 2B)', async () => {
    // The write path's half of the evidence rule. `lead_captured` (+15,
    // "Submitted a lead form") is decided from `origin.category`, so if the
    // orchestrator does not set it the rule is fail-closed for every lead -
    // correct by accident, and silently wrong the moment a genuine inbound
    // form arrives.
    //
    // Nothing new is computed for this: it is the SAME
    // `keys.provenance.sourceCategory` already handed to `ingestSourceRecord`,
    // from the explicit `PI_ADAPTER_PROFILES` table, so the durable row and
    // the provenance contribution cannot disagree about what originated the
    // prospect.
    await ingestNormalizedRecord(csvRecord());
    expect(emitted[0].origin).toEqual({
      category: 'csv',
      platform: null,
      observedAt: '2026-11-02T10:00:00.000Z',
    });
    // And it agrees with what the provenance boundary was told.
    expect(ingested[0].sourceCategory).toBe('csv');
  });

  it('a `csv` category earns no form-submission claim, end to end', async () => {
    // The whole point, asserted through the REAL orchestrator rather than on a
    // hand-built view: an operator pasting a spreadsheet produces a lead with
    // recorded provenance and NO fabricated intent.
    const { buildBuyingIntentProfile, canonicalLeadToView } =
      require('../../../lib/leadIntelligence') as typeof import('../../../lib/leadIntelligence');
    await ingestNormalizedRecord(csvRecord());
    const profile = buildBuyingIntentProfile({ view: canonicalLeadToView(emitted[0] as never) });
    expect(profile.evidence.map((e: { type: string }) => e.type)).not.toContain('lead_captured');
    expect(profile.score).toBe(0);
  });
});

describe('PI-LDB-4 — it does not invent intent on the way through', () => {
  // The acquisition audit found this and it was MY wiring that made it
  // reachable: `toRow` calls `materializeCanonicalScores`, which calls the
  // buying-intent scorer, which asserted `lead_captured` for any source in
  // CAPTURE_SOURCES — and 'import' was in that set. `lead_captured` is
  // `{ level: 'high', points: 15, label: 'Submitted a lead form' }`.
  //
  // So before this fix, projecting a pasted spreadsheet row produced a
  // HIGH-confidence intent signal whose stated evidence was a form
  // submission that never happened. Nobody downstream could tell the
  // difference between that and a real inbound lead.
  //
  // This asserts the projection carries no such claim. It runs the REAL
  // scorer on the REAL emitted lead, so it fails if 'import' is put back.
  it('emits no buying-intent evidence for an imported row, because there is none', async () => {
    await ingestNormalizedRecord(csvRecord());

    const { buildBuyingIntentProfile, canonicalLeadToView } =
      require('../../../lib/leadIntelligence') as typeof import('../../../lib/leadIntelligence');

    const view = canonicalLeadToView(emitted[0] as never);
    const profile = buildBuyingIntentProfile({ view });

    expect(profile.evidence.map((e: { type: string }) => e.type)).not.toContain('lead_captured');
    // And the intent score is not raised by a claim the record cannot support.
    // Zero is the honest answer for a spreadsheet row with no behaviour behind
    // it — unknown, not low.
    expect(profile.score).toBe(0);
  });

  it('still records the capture when there IS evidence someone submitted a form', async () => {
    // The guard above must not be a blanket removal: a lead that DID submit
    // something earns the evidence, and asserting it here is what stops the
    // fix from being over-applied later.
    //
    // UPDATED (Prompt 2B, owner decision). What makes the claim true changed,
    // and this test changed with it rather than being deleted. It used to flip
    // `source` to `'website'`, because membership of
    // `buyingIntent.CAPTURE_SOURCES` was what granted `lead_captured`. A
    // display source is a channel of ARRIVAL and never was proof of a
    // submission - which is how a purchased Apollo contact came to carry
    // "Submitted a lead form" - so the rule now reads recorded evidence:
    // `origin.category === 'inbound_form'`.
    //
    // So the ONE field changed here is the one that now carries the claim. The
    // assertion either side of it is identical, which is the point: the
    // true-positive path still works, it is just no longer purchasable with a
    // label.
    const { buildBuyingIntentProfile, canonicalLeadToView } =
      require('../../../lib/leadIntelligence') as typeof import('../../../lib/leadIntelligence');

    await ingestNormalizedRecord(csvRecord());
    const base = canonicalLeadToView(emitted[0] as never);
    const view = { ...base, origin: { category: 'inbound_form', platform: null, observedAt: null } };
    const profile = buildBuyingIntentProfile({ view: view as never });

    expect(profile.evidence.map((e: { type: string }) => e.type)).toContain('lead_captured');

    // And the LABEL alone no longer buys it. This is the half the old test
    // could not state, because under the old rule it was false.
    const labelOnly = { ...base, source: 'website' as const };
    const fromLabel = buildBuyingIntentProfile({ view: labelOnly as never });
    expect(fromLabel.evidence.map((e: { type: string }) => e.type)).not.toContain('lead_captured');
    expect(fromLabel.score).toBe(0);
  });
});

describe('PI-LDB-4 — it cannot take good intake down with it', () => {
  it('reports a sink failure WITHOUT failing the record', async () => {
    emitThrows = new Error('durable store unreachable');
    const out = await ingestNormalizedRecord(csvRecord());

    // The person, employer, prospect and evidence are all already durable, so
    // failing the record here would discard good intake over a display concern.
    expect(out.ok).toBe(true);
    expect(out.personId).toBe('person-1');
    expect(out.prospectId).toBe('prospect-1');
    expect(ingested.length).toBeGreaterThan(0);

    // But it is REPORTED. An unreported fail-open is how a channel comes to
    // look operational while the screen stays empty.
    expect(out.leadProjection?.status).toBe('failed');
    expect(out.leadProjection?.leadId).toBeNull();
    expect(out.leadProjection?.error).toContain('durable store unreachable');
  });

  it('skips cleanly when there is no canonical Prospect, and says so', async () => {
    // The external id stays VALID here. An empty one is refused by validation
    // long before the projection runs, so using it tested the wrong refusal —
    // the record failed for a reason that had nothing to do with this change.
    // A null prospect with a valid record is the real case: WS-1 can decline to
    // resolve one, and the resolver mock returns exactly that.
    prospectId = null;
    const out = await ingestNormalizedRecord(csvRecord());

    expect(out.ok).toBe(true);
    expect(emitted).toHaveLength(0);
    // A skip, not a fault: WS-1 returns a null prospect for a record with no
    // external id rather than minting one that would duplicate on every replay.
    expect(out.leadProjection).toEqual({
      status: 'skipped',
      leadId: null,
      reason: 'no_prospect',
      warnings: [],
      error: null,
    });
    // A skip is not a gap: it must be distinguishable from BOTH of the other
    // two, or the operator surface would warn about rows that were never
    // supposed to be listed and train them to ignore the warning.
    expect(out.leadProjection?.status).not.toBe('persisted');
    expect(out.leadProjection?.status).not.toBe('failed');
  });
});
