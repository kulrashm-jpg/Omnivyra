/**
 * INT-002 Wave 2 — Envelope Version 2 characterization.
 *
 * Proves: legacy schema-1 records still load; new records persist all three
 * intelligence layers (Phase 2 summary + Phase 3 qualification planning +
 * Phase 5 automation planning); the serialized row roundtrips losslessly;
 * the version bump makes v1 records stale; regeneration upgrades them to
 * fresh v2 records; output is deterministic. Ports injected, fixed clock,
 * no randomness, no wall-clock dependence.
 */

const mockUpserts: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    chain.update = () => chain;
    chain.upsert = async (row: Record<string, unknown>) => {
      mockUpserts.push({ __table: table, ...row });
      return { error: null };
    };
    return chain;
  },
}));

import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  durableIntelligencePersistence,
  rowToIntelligenceRecord,
  resolveIntelligenceFreshness,
  isSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSIONS,
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  ORCHESTRATED_ENGINES,
  type LeadIntelligenceRecord,
  type RawLeadRows,
} from '../../services/leadIntelligenceOrchestration';
import { toLeadIntelligenceView } from '../../services/leadIntelligenceReadApi';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const NOW_ISO = '2026-08-03T12:00:00.000Z';
const REF = { companyId: 'co1', leadId: 'L1' };

const baseRows = (): RawLeadRows => ({
  leadRow: {
    id: 'L1',
    company_id: 'co1',
    email: 'cto@bigcorp.com',
    name: 'Sam',
    source: 'website',
    created_at: '2026-08-03T11:00:00.000Z',
    visitor_session_id: 'vs1',
    metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
  },
  trackingEventRows: [
    { id: 't1', event_name: 'page_view', page_url: '/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
    { id: 't2', event_name: 'page_view', page_url: '/enterprise', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:05:00.000Z', metadata: {} },
    { id: 't3', event_name: 'page_view', page_url: '/book-a-demo', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:10:00.000Z', metadata: {} },
  ],
  visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:59:00.000Z' }],
  touchpointRows: [],
});

const makeOrchestrator = () => {
  const store = createInMemoryIntelligenceStore();
  const orchestrator = createLeadIntelligenceOrchestrator({
    persistence: store,
    snapshotSource: { load: async () => baseRows() },
    clock: () => T0,
  });
  return { orchestrator, store };
};

/** A schema-1-era record as it would exist in memory after a v1 row load. */
const legacyRecordOf = (record: LeadIntelligenceRecord): LeadIntelligenceRecord => ({
  ...record,
  engineVersion: 'lie-1.0.0',
  schemaVersion: 1,
  generationVersion: 3,
  qualificationPlanning: null,
  automationPlanning: null,
});

beforeEach(() => {
  mockUpserts.length = 0;
});

describe('INT-002 Wave 2 — version bump', () => {
  it('bumps engine and schema versions and keeps v1 loadable', () => {
    expect(ENGINE_VERSION).toBe('lie-2.0.0');
    expect(INTELLIGENCE_SCHEMA_VERSION).toBe(2);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2]);
    expect(isSupportedSchemaVersion(1)).toBe(true);
    expect(isSupportedSchemaVersion(2)).toBe(true);
    expect(isSupportedSchemaVersion(3)).toBe(false);
    expect(ORCHESTRATED_ENGINES).toContain('qualificationPlanning');
    expect(ORCHESTRATED_ENGINES).toContain('automationExecution');
  });
});

describe('INT-002 Wave 2 — new records contain all three layers', () => {
  it('generates Phase 2 + Phase 3 + Phase 5 in one deterministic envelope', async () => {
    const { orchestrator } = makeOrchestrator();
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    const record = result.record!;

    // Envelope versioning.
    expect(record.engineVersion).toBe('lie-2.0.0');
    expect(record.schemaVersion).toBe(2);

    // Layer 1 — Phase 2 summary (unchanged shape).
    expect(record.intelligence.persona.persona).toBe('CTO');
    expect(record.intelligence.qualification.sections).toHaveLength(5);

    // Layer 2 — Phase 3 qualification planning.
    const planning = record.qualificationPlanning!;
    expect(planning).not.toBeNull();
    expect(planning.leadId).toBe('L1');
    expect(planning.qualification.dimensions).toHaveLength(5);
    expect(planning.qualification.totalScore).toBeGreaterThan(0);
    expect(planning.recommendedChannels.length).toBeGreaterThan(0);
    expect(planning.recommendedActions.length).toBeGreaterThan(0);
    expect(planning.recommendedPlan.steps.length).toBeGreaterThan(0);
    expect(planning.generatedAt).toBe(NOW_ISO);

    // Layer 3 — Phase 5 automation planning.
    const automation = record.automationPlanning!;
    expect(automation).not.toBeNull();
    expect(['ready', 'waiting', 'manual_review', 'blocked', 'insufficient_data']).toContain(automation.status);
    expect(automation.tasks.length).toBeGreaterThan(0);
    expect(automation.generatedAt).toBe(NOW_ISO);

    // Diagnostics record the planning engines as executed.
    expect(record.diagnostics.enginesExecuted).toEqual([...ORCHESTRATED_ENGINES]);
    expect(result.warnings).toEqual([]);
  });

  it('is deterministic — independent orchestrators produce identical v2 envelopes', async () => {
    const a = await makeOrchestrator().orchestrator.generate(REF);
    const b = await makeOrchestrator().orchestrator.generate(REF);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });

  it('unchanged inputs still skip regeneration at v2', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.generate(REF);
    const second = await orchestrator.generate(REF);
    expect(second.status).toBe('skipped_unchanged');
    expect(second.record!.generationVersion).toBe(1);
  });
});

describe('INT-002 Wave 2 — schema migration compatibility', () => {
  it('the serialized v2 row roundtrips losslessly through the durable mapping', async () => {
    const { orchestrator } = makeOrchestrator();
    const record = (await orchestrator.generate(REF)).record!;

    const write = await durableIntelligencePersistence.upsert(record);
    expect(write.ok).toBe(true);
    expect(mockUpserts).toHaveLength(1);
    const row = mockUpserts[0];
    expect(row.__table).toBe('lead_intelligence_profiles');

    // The JSONB column carries the wrapped v2 payload.
    const payload = row.intelligence as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['automationPlanning', 'qualificationPlanning', 'summary']);

    const roundtripped = rowToIntelligenceRecord(row)!;
    expect(roundtripped).toEqual(record);
  });

  it('legacy schema-1 rows (summary stored directly) still load with null planning layers', async () => {
    const { orchestrator } = makeOrchestrator();
    const v2 = (await orchestrator.generate(REF)).record!;

    const legacyRow = {
      company_id: 'co1',
      lead_id: 'L1',
      intelligence: v2.intelligence, // v1 stored the Phase 2 summary DIRECTLY
      diagnostics: v2.diagnostics,
      input_fingerprint: v2.inputFingerprint,
      engine_version: 'lie-1.0.0',
      generation_version: 3,
      schema_version: 1,
      generated_at: NOW_ISO,
      rebuild_requested_at: null,
    };
    const loaded = rowToIntelligenceRecord(legacyRow)!;
    expect(loaded).not.toBeNull();
    expect(loaded.intelligence).toEqual(v2.intelligence);
    expect(loaded.qualificationPlanning).toBeNull();
    expect(loaded.automationPlanning).toBeNull();
    expect(loaded.schemaVersion).toBe(1);

    // Read API still serves the legacy record; planning layers surface null.
    const view = toLeadIntelligenceView(loaded, REF);
    expect(view.status).toBe('available');
    expect(view.intent!.score).toBe(v2.intelligence.intent.score);
    expect(view.qualificationPlanning).toBeNull();
    expect(view.automationPlanning).toBeNull();
  });

  it('an unsupported future schema version reads as stale, never throws', async () => {
    const { orchestrator } = makeOrchestrator();
    const record = (await orchestrator.generate(REF)).record!;
    expect(resolveIntelligenceFreshness({ ...record, schemaVersion: 99 })).toBe('stale');
  });
});

describe('INT-002 Wave 2 — staleness and regeneration lifecycle', () => {
  it('the version bump makes v1-era records stale', async () => {
    const { orchestrator } = makeOrchestrator();
    const v2 = (await orchestrator.generate(REF)).record!;
    const legacy = legacyRecordOf(v2);
    expect(resolveIntelligenceFreshness(legacy)).toBe('stale');
    expect(resolveIntelligenceFreshness(legacy, v2.inputFingerprint)).toBe('stale'); // even with matching inputs
  });

  it('a stale v1 record regenerates into a fresh v2 record with all layers', async () => {
    const { orchestrator, store } = makeOrchestrator();
    const v2 = (await orchestrator.generate(REF)).record!;
    store.records.set('co1::L1', legacyRecordOf(v2));
    expect(await orchestrator.freshness(REF)).toBe('stale');

    const regen = await orchestrator.generate(REF); // no force needed
    expect(regen.status).toBe('generated');
    const upgraded = regen.record!;
    expect(upgraded.engineVersion).toBe('lie-2.0.0');
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.generationVersion).toBe(4); // history preserved: 3 + 1
    expect(upgraded.qualificationPlanning).not.toBeNull();
    expect(upgraded.automationPlanning).not.toBeNull();

    expect(await orchestrator.freshness(REF)).toBe('fresh');
    expect(resolveIntelligenceFreshness(upgraded, upgraded.inputFingerprint)).toBe('fresh');
  });
});

describe('INT-002 Wave 2 — read API exposure of the new layers', () => {
  it('maps the persisted planning layers into normalized DTOs', async () => {
    const { orchestrator } = makeOrchestrator();
    const record = (await orchestrator.generate(REF)).record!;
    const view = toLeadIntelligenceView(record, REF);

    const qp = view.qualificationPlanning!;
    expect(qp).not.toBeNull();
    expect(qp.totalScore).toBe(record.qualificationPlanning!.qualification.totalScore);
    expect(qp.band).toBe(record.qualificationPlanning!.qualification.band);
    expect(qp.dimensions).toHaveLength(5);
    expect(qp.channels.length).toBeGreaterThan(0);
    expect(qp.actions.length).toBeGreaterThan(0);
    expect(qp.plan!.playbook).toBe(record.qualificationPlanning!.recommendedPlan.playbook);
    expect(qp.plan!.steps.length).toBe(record.qualificationPlanning!.recommendedPlan.steps.length);

    const ap = view.automationPlanning!;
    expect(ap).not.toBeNull();
    expect(ap.status).toBe(record.automationPlanning!.status);
    expect(ap.tasks.length).toBe(record.automationPlanning!.tasks.length);
    expect(ap.timeline.length).toBe(record.automationPlanning!.executionTimeline.length);
    expect(ap.review).not.toBeNull();
  });

  it('malformed planning payloads degrade to null without throwing', async () => {
    const { orchestrator } = makeOrchestrator();
    const record = (await orchestrator.generate(REF)).record!;
    const broken: LeadIntelligenceRecord = {
      ...record,
      qualificationPlanning: 'garbage' as unknown as LeadIntelligenceRecord['qualificationPlanning'],
      automationPlanning: { nope: true } as unknown as LeadIntelligenceRecord['automationPlanning'],
    };
    const view = toLeadIntelligenceView(broken, REF);
    expect(view.status).toBe('available');
    expect(view.qualificationPlanning).toBeNull();
    expect(view.automationPlanning).toBeNull();
  });
});
