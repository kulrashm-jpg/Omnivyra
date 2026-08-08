/**
 * INT-001 Phase 4 test suite — orchestration flow, persistence, incremental
 * regeneration (fingerprint skip/rebuild), versioning, freshness, diagnostics,
 * rebuild boundaries, read integration, failure modes. All ports injected
 * in-memory; deterministic injected clock; no randomness; no snapshot-only
 * assertions. writeOwner is mocked for safe module load only — no test relies
 * on a real DB.
 */

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    chain.upsert = async () => ({ error: null });
    chain.update = () => chain;
    return chain;
  },
}));

import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  resolveIntelligenceFreshness,
  computeInputFingerprint,
  stableStringify,
  rowToIntelligenceRecord,
  getPersistedLeadIntelligence,
  getEnrichedLeadProfileWithIntelligence,
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  ORCHESTRATED_ENGINES,
  type IntelligenceSnapshotSourcePort,
  type RawLeadRows,
  type LeadIntelligenceRecord,
} from '../../services/leadIntelligenceOrchestration';
import { assembleLeadCaptureSnapshot } from '../../services/leadIntelligenceEngine';
import { searchLeads, getEnrichedLeadProfile, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import { leadKeyFor } from '../../../lib/leadIntelligence';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const NOW_ISO = '2026-08-03T12:00:00.000Z';
const fixedClock = (): number => T0;
const REF = { companyId: 'co1', leadId: 'L1' };

const leadRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'L1',
  company_id: 'co1',
  email: 'cto@bigcorp.com',
  name: 'Sam',
  source: 'website',
  created_at: '2026-08-03T11:00:00.000Z',
  visitor_session_id: 'vs1',
  metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
  ...over,
});

const eventRow = (id: string, url: string, at: string): Record<string, unknown> => ({
  id,
  event_name: 'page_view',
  page_url: url,
  visitor_session_id: 'vs1',
  occurred_at: at,
  metadata: {},
});

const baseRows = (): RawLeadRows => ({
  leadRow: leadRow(),
  trackingEventRows: [
    eventRow('t1', '/pricing', '2026-08-03T10:00:00.000Z'),
    eventRow('t2', '/enterprise', '2026-08-03T10:05:00.000Z'),
  ],
  visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:59:00.000Z' }],
  touchpointRows: [{ id: 'tp1', touchpoint_type: 'first_touch', source: 'google', touched_at: '2026-08-03T09:59:00.000Z' }],
});

const sourceOf = (rows: RawLeadRows | null): IntelligenceSnapshotSourcePort & { loads: number } => {
  const port = {
    loads: 0,
    async load() {
      port.loads += 1;
      return rows;
    },
  };
  return port;
};

const makeOrchestrator = (rows: RawLeadRows | null = baseRows(), extra: Record<string, unknown> = {}) => {
  const store = createInMemoryIntelligenceStore();
  const source = sourceOf(rows);
  const orchestrator = createLeadIntelligenceOrchestrator({
    persistence: store,
    snapshotSource: source,
    clock: fixedClock,
    ...extra,
  });
  return { orchestrator, store, source };
};

describe('INT-001 Phase 4 — orchestration flow', () => {
  it('generates, persists and returns a complete intelligence record', async () => {
    const { orchestrator, store } = makeOrchestrator();
    const result = await orchestrator.generate(REF);

    expect(result.status).toBe('generated');
    expect(result.persisted).toBe(true);
    expect(result.freshness).toBe('fresh');
    expect(result.error).toBeNull();

    const record = result.record!;
    expect(record.companyId).toBe('co1');
    expect(record.leadId).toBe('L1');
    expect(record.engineVersion).toBe(ENGINE_VERSION);
    expect(record.schemaVersion).toBe(INTELLIGENCE_SCHEMA_VERSION);
    expect(record.generationVersion).toBe(1);
    expect(record.generatedAt).toBe(NOW_ISO);
    expect(record.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.rebuildRequestedAt).toBeNull();

    // The consolidated summary contains every section.
    expect(record.intelligence.persona.persona).toBe('CTO');
    expect(record.intelligence.intent.score).toBeGreaterThan(0);
    expect(record.intelligence.qualification.sections).toHaveLength(5);
    expect(record.intelligence.segments.length).toBeGreaterThan(0);
    expect(record.intelligence.timeline.length).toBeGreaterThan(0);
    expect(record.intelligence.generatedAt).toBe(NOW_ISO);

    // Persisted exactly once under (company, lead).
    expect(store.records.size).toBe(1);
    expect(await orchestrator.getPersisted(REF)).toEqual(record);
  });

  it('fails cleanly when the lead does not exist', async () => {
    const { orchestrator } = makeOrchestrator(null);
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('lead not found');
    expect(result.record).toBeNull();
    expect(result.freshness).toBe('never_generated');
  });

  it('fails cleanly when the snapshot source throws', async () => {
    const { store } = makeOrchestrator();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store,
      snapshotSource: { load: async () => { throw new Error('db unreachable'); } },
      clock: fixedClock,
    });
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('snapshot load failed: db unreachable');
  });

  it('reports engine failures without persisting anything', async () => {
    const { orchestrator, store } = makeOrchestrator(baseRows(), {
      engineConfig: { intent: {} as never },
    });
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('engine failure');
    expect(result.persisted).toBe(false);
    expect(store.records.size).toBe(0);
  });
});

describe('INT-001 Phase 4 — incremental regeneration & fingerprints', () => {
  it('skips rebuild when inputs are unchanged (idempotent, nothing rewritten)', async () => {
    const { orchestrator } = makeOrchestrator();
    const first = await orchestrator.generate(REF);
    const second = await orchestrator.generate(REF);

    expect(first.status).toBe('generated');
    expect(second.status).toBe('skipped_unchanged');
    expect(second.persisted).toBe(false);
    expect(second.record).toEqual(first.record);
    expect(second.record!.generationVersion).toBe(1);
  });

  it('rebuilds when a new tracking event arrives (fingerprint change detection)', async () => {
    const store = createInMemoryIntelligenceStore();
    let rows = baseRows();
    const source: IntelligenceSnapshotSourcePort = { load: async () => rows };
    const orchestrator = createLeadIntelligenceOrchestrator({ persistence: store, snapshotSource: source, clock: fixedClock });

    const first = await orchestrator.generate(REF);
    rows = {
      ...baseRows(),
      trackingEventRows: [...(baseRows().trackingEventRows ?? []), eventRow('t3', '/book-a-demo', '2026-08-03T11:30:00.000Z')],
    };
    const second = await orchestrator.generate(REF);

    expect(second.status).toBe('generated');
    expect(second.record!.generationVersion).toBe(2);
    expect(second.record!.inputFingerprint).not.toBe(first.record!.inputFingerprint);
    expect(second.record!.intelligence.intent.score).toBeGreaterThan(first.record!.intelligence.intent.score);
  });

  it('rebuilds when lead enrichment changes (metadata fingerprinted too)', async () => {
    const store = createInMemoryIntelligenceStore();
    let rows = baseRows();
    const source: IntelligenceSnapshotSourcePort = { load: async () => rows };
    const orchestrator = createLeadIntelligenceOrchestrator({ persistence: store, snapshotSource: source, clock: fixedClock });

    await orchestrator.generate(REF);
    rows = { ...baseRows(), leadRow: leadRow({ metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Banking' } }) };
    const second = await orchestrator.generate(REF);
    expect(second.status).toBe('generated');
    expect(second.record!.generationVersion).toBe(2);
  });

  it('force rebuild regenerates even with identical inputs, and is idempotent in content', async () => {
    const { orchestrator } = makeOrchestrator();
    const first = await orchestrator.generate(REF);
    const second = await orchestrator.rebuild(REF);
    const third = await orchestrator.rebuild(REF);

    expect(second.status).toBe('generated');
    expect(second.record!.generationVersion).toBe(2);
    expect(third.record!.generationVersion).toBe(3);
    // Same inputs + same clock → identical intelligence and fingerprint.
    expect(JSON.stringify(second.record!.intelligence)).toBe(JSON.stringify(first.record!.intelligence));
    expect(third.record!.inputFingerprint).toBe(first.record!.inputFingerprint);
  });

  it('a stale engine version triggers regeneration on the next generate', async () => {
    const { orchestrator, store } = makeOrchestrator();
    const first = await orchestrator.generate(REF);
    store.records.set('co1::L1', { ...first.record!, engineVersion: 'lie-0.9.0' });

    const second = await orchestrator.generate(REF);
    expect(second.status).toBe('generated');
    expect(second.record!.engineVersion).toBe(ENGINE_VERSION);
    expect(second.record!.generationVersion).toBe(2);
  });

  it('fingerprint is order-insensitive and time-independent, but data-sensitive', () => {
    const rows = baseRows();
    const a = assembleLeadCaptureSnapshot({ ...rows, now: '2026-08-03T12:00:00.000Z' });
    const b = assembleLeadCaptureSnapshot({
      ...rows,
      trackingEventRows: [...(rows.trackingEventRows ?? [])].reverse(),
      now: '2026-09-01T00:00:00.000Z', // different evaluation time
    });
    expect(computeInputFingerprint(a)).toBe(computeInputFingerprint(b));

    const c = assembleLeadCaptureSnapshot({
      ...rows,
      trackingEventRows: [...(rows.trackingEventRows ?? []), eventRow('t9', '/security', '2026-08-03T11:00:00.000Z')],
      now: '2026-08-03T12:00:00.000Z',
    });
    expect(computeInputFingerprint(c)).not.toBe(computeInputFingerprint(a));
  });

  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1])); // arrays keep order
  });
});

describe('INT-001 Phase 4 — freshness', () => {
  it('resolveIntelligenceFreshness covers all deterministic states', () => {
    const record: LeadIntelligenceRecord = {
      companyId: 'co1', leadId: 'L1',
      intelligence: {} as LeadIntelligenceRecord['intelligence'],
      diagnostics: {} as LeadIntelligenceRecord['diagnostics'],
      inputFingerprint: 'fp1', engineVersion: ENGINE_VERSION,
      generationVersion: 1, schemaVersion: 1,
      generatedAt: NOW_ISO, rebuildRequestedAt: null,
      // INT-001 Phase 3 added these planning sections to the record. This test
      // exercises freshness resolution only, which reads none of them — stubbed
      // like `intelligence`/`diagnostics` above rather than fabricating content.
      qualificationPlanning: {} as LeadIntelligenceRecord['qualificationPlanning'],
      automationPlanning: {} as LeadIntelligenceRecord['automationPlanning'],
    };
    expect(resolveIntelligenceFreshness(null)).toBe('never_generated');
    expect(resolveIntelligenceFreshness({ ...record, rebuildRequestedAt: NOW_ISO })).toBe('pending_regeneration');
    expect(resolveIntelligenceFreshness({ ...record, engineVersion: 'old' })).toBe('stale');
    expect(resolveIntelligenceFreshness(record, 'fp-different')).toBe('stale');
    expect(resolveIntelligenceFreshness(record, 'fp1')).toBe('fresh');
    expect(resolveIntelligenceFreshness(record)).toBe('fresh'); // no fingerprint supplied
  });

  it('orchestrator.freshness tracks the full lifecycle', async () => {
    const store = createInMemoryIntelligenceStore();
    let rows: RawLeadRows | null = baseRows();
    const source: IntelligenceSnapshotSourcePort = { load: async () => rows };
    const orchestrator = createLeadIntelligenceOrchestrator({ persistence: store, snapshotSource: source, clock: fixedClock });

    expect(await orchestrator.freshness(REF)).toBe('never_generated');
    await orchestrator.generate(REF);
    expect(await orchestrator.freshness(REF)).toBe('fresh');

    rows = { ...baseRows(), trackingEventRows: [...(baseRows().trackingEventRows ?? []), eventRow('t3', '/demo', '2026-08-03T11:45:00.000Z')] };
    expect(await orchestrator.freshness(REF)).toBe('stale');

    await orchestrator.generate(REF); // regenerate with the new event
    expect(await orchestrator.freshness(REF)).toBe('fresh');

    await orchestrator.requestRebuild(REF);
    expect(await orchestrator.freshness(REF)).toBe('pending_regeneration');
  });
});

describe('INT-001 Phase 4 — background rebuild boundaries', () => {
  it('requestRebuild marks the record pending and the next generate clears it', async () => {
    const { orchestrator, store } = makeOrchestrator();
    await orchestrator.generate(REF);

    const request = await orchestrator.requestRebuild(REF, 'new attribution');
    expect(request).toEqual({ accepted: true, leadId: 'L1', mode: 'marked', error: null });
    expect((await store.get('co1', 'L1'))!.rebuildRequestedAt).toBe(NOW_ISO);

    // Inputs unchanged, but the pending flag forces regeneration and clears it.
    const regen = await orchestrator.generate(REF);
    expect(regen.status).toBe('generated');
    expect(regen.record!.generationVersion).toBe(2);
    expect(regen.record!.rebuildRequestedAt).toBeNull();
  });

  it('requestRebuild without an existing record fails deterministically (no queue port)', async () => {
    const { orchestrator } = makeOrchestrator();
    const request = await orchestrator.requestRebuild(REF);
    expect(request.accepted).toBe(false);
    expect(request.mode).toBe('failed');
  });

  it('hands rebuilds to an injected queue port without implementing a queue', async () => {
    const enqueued: Array<Record<string, unknown>> = [];
    const { orchestrator } = makeOrchestrator(baseRows(), {
      rebuildQueue: { enqueue: async (r: Record<string, unknown>) => { enqueued.push(r); } },
    });
    await orchestrator.generate(REF);
    const request = await orchestrator.requestRebuild(REF, 'company enrichment');
    expect(request.mode).toBe('queued');
    expect(enqueued).toEqual([{ companyId: 'co1', leadId: 'L1', requestedAt: NOW_ISO, reason: 'company enrichment' }]);
  });

  it('bulk rebuild returns one deterministic result per lead in order', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.generate(REF);
    const results = await orchestrator.requestBulkRebuild('co1', ['L1', 'missing-lead']);
    expect(results.map((r) => r.leadId)).toEqual(['L1', 'missing-lead']);
    expect(results[0].accepted).toBe(true);
    expect(results[1].accepted).toBe(false);
  });
});

describe('INT-001 Phase 4 — versioning & diagnostics', () => {
  it('exposes generation version, engine version, fingerprint and generatedAt', async () => {
    const { orchestrator } = makeOrchestrator();
    const result = await orchestrator.generate(REF);
    const record = result.record!;
    expect(record.engineVersion).toBe(ENGINE_VERSION);
    expect(record.generationVersion).toBe(1);
    expect(record.schemaVersion).toBe(INTELLIGENCE_SCHEMA_VERSION);
    expect(record.inputFingerprint.length).toBe(64);
    expect(record.generatedAt).toBe(NOW_ISO);
  });

  it('diagnostics record engines executed, counts, confidence breakdown and enrichment gaps', async () => {
    const rows: RawLeadRows = { ...baseRows(), leadRow: leadRow({ metadata: { job_title: 'CTO' } }) };
    const { orchestrator } = makeOrchestrator(rows);
    const { record } = await orchestrator.generate(REF);
    const d = record!.diagnostics;

    expect(d.enginesExecuted).toEqual([...ORCHESTRATED_ENGINES]);
    expect(d.engineVersion).toBe(ENGINE_VERSION);
    expect(d.durationMs).toBeGreaterThanOrEqual(0);
    expect(d.inputCounts).toEqual({ events: 2, sessions: 1, touchpoints: 1 });
    expect(d.missingEnrichment).toEqual(['companyName', 'companySize', 'industry']);
    expect(d.confidenceBreakdown.overall).toBe(record!.intelligence.confidence);
    expect(d.confidenceBreakdown.persona).toBe(record!.intelligence.persona.confidence);
    expect(d.confidenceBreakdown.qualificationBand).toBe(record!.intelligence.qualification.band);
  });

  it('warns about empty journeys in diagnostics', async () => {
    const rows: RawLeadRows = { leadRow: leadRow({ metadata: {} }), trackingEventRows: [], visitorSessionRows: [], touchpointRows: [] };
    const { orchestrator } = makeOrchestrator(rows);
    const { record } = await orchestrator.generate(REF);
    expect(record!.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        'no tracking events captured for this lead',
        'no visitor sessions linked to this lead',
        'no intent signals detected',
      ]),
    );
  });

  it('is deterministic — two independent orchestrators produce identical records', async () => {
    const a = await makeOrchestrator().orchestrator.generate(REF);
    const b = await makeOrchestrator().orchestrator.generate(REF);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });
});

describe('INT-001 Phase 4 — persistence', () => {
  it('reports persistence failures while still returning the computed intelligence', async () => {
    const { orchestrator, store } = makeOrchestrator();
    store.failWrites(true);
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(result.persisted).toBe(false);
    expect(result.warnings[0]).toContain('persistence failed');
    expect(result.record!.intelligence.persona.persona).toBe('CTO');
    expect(store.records.size).toBe(0);
  });

  it('rowToIntelligenceRecord tolerates partial/legacy rows', () => {
    expect(rowToIntelligenceRecord(null)).toBeNull();
    expect(rowToIntelligenceRecord({ company_id: 'co1' })).toBeNull(); // no lead/intelligence

    const partial = rowToIntelligenceRecord({
      company_id: 'co1',
      lead_id: 'L1',
      intelligence: { confidence: 0.5 },
      // diagnostics, versions, fingerprint all missing
    });
    expect(partial).not.toBeNull();
    expect(partial!.generationVersion).toBe(1);
    expect(partial!.engineVersion).toBe('unknown');
    expect(partial!.diagnostics.warnings).toContain('diagnostics missing on persisted row');
    expect(resolveIntelligenceFreshness(partial)).toBe('stale'); // unknown engine version → stale
  });
});

describe('INT-001 Phase 4 — read integration', () => {
  const readServiceLeadRow = { id: 'L1', company_id: 'co1', email: 'cto@bigcorp.com', source: 'form_embed' };
  const readers: LeadSourceReaders = {
    durable: async () => [],
    activeLeads: async () => [],
    leads: async () => [readServiceLeadRow],
    canonicalLeads: async () => [],
  };

  const leadKeyOf = async (): Promise<string> => {
    const res = await searchLeads({ companyId: 'co1' }, readers);
    return leadKeyFor(res.rows[0]);
  };

  it('attaches persisted intelligence additively without altering the base profile', async () => {
    const { orchestrator, store } = makeOrchestrator();
    await orchestrator.generate(REF);
    const leadKey = await leadKeyOf();

    const base = await getEnrichedLeadProfile('co1', leadKey, readers);
    const withIntel = await getEnrichedLeadProfileWithIntelligence('co1', leadKey, { readers, persistence: store });

    expect(withIntel).not.toBeNull();
    const { intelligence, intelligenceMeta, ...rest } = withIntel!;
    // Existing contract byte-identical: every base field passes through unchanged.
    expect(JSON.stringify(rest)).toBe(JSON.stringify(base));
    // Additive fields carry the persisted intelligence (no recomputation).
    expect(intelligence).toEqual((await store.get('co1', 'L1'))!.intelligence);
    expect(intelligenceMeta).toEqual({
      freshness: 'fresh',
      generatedAt: NOW_ISO,
      engineVersion: ENGINE_VERSION,
      generationVersion: 1,
      leadId: 'L1',
    });
  });

  it('missing intelligence → null payload with never_generated freshness', async () => {
    const store = createInMemoryIntelligenceStore();
    const leadKey = await leadKeyOf();
    const withIntel = await getEnrichedLeadProfileWithIntelligence('co1', leadKey, { readers, persistence: store });
    expect(withIntel!.intelligence).toBeNull();
    expect(withIntel!.intelligenceMeta.freshness).toBe('never_generated');
    expect(withIntel!.intelligenceMeta.leadId).toBe('L1');
  });

  it('unknown lead key returns null exactly like the base read', async () => {
    const store = createInMemoryIntelligenceStore();
    const result = await getEnrichedLeadProfileWithIntelligence('co1', 'lead:nope', { readers, persistence: store });
    expect(result).toBeNull();
  });

  it('getPersistedLeadIntelligence reads without computing', async () => {
    const { orchestrator, store, source } = makeOrchestrator();
    await orchestrator.generate(REF);
    const loadsAfterGenerate = source.loads;

    const { record, freshness } = await getPersistedLeadIntelligence('co1', 'L1', store);
    expect(record!.generationVersion).toBe(1);
    expect(freshness).toBe('fresh');
    expect(source.loads).toBe(loadsAfterGenerate); // no snapshot loads on read

    const missing = await getPersistedLeadIntelligence('co1', 'other', store);
    expect(missing.record).toBeNull();
    expect(missing.freshness).toBe('never_generated');
  });
});
