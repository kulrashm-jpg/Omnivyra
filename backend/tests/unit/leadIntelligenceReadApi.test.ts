/**
 * INT-001 Phase 6 test suite — read APIs & DTO layer.
 *
 * The Phase 4 orchestrator is used ONLY as a test fixture factory to produce a
 * realistic persisted record; the module under test never invokes it. All
 * ports injected; fixed clock; no randomness; no snapshot assertions; no
 * wall-clock dependence. writeOwner mocked for safe module load only.
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
  createLeadIntelligenceReadApi,
  toLeadIntelligenceView,
  toLeadIntelligenceListItem,
  overallScoreOf,
  qualificationBandOf,
  primaryPersonaOf,
  primarySegmentOf,
  highestConfidenceChannelOf,
  topRecommendationOf,
  topActionOf,
  recommendationPreviewOf,
  timelinePreviewOf,
  confidenceSummaryOf,
  describeFreshness,
  aggregateIntelligenceViews,
  type LeadIntelligenceViewDTO,
  type IntelligenceFreshness,
} from '../../services/leadIntelligenceReadApi';
import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  rowToIntelligenceRecord,
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  type LeadIntelligenceRecord,
  type RawLeadRows,
} from '../../services/leadIntelligenceOrchestration';

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

/** Test-fixture factory: persist one realistic record via the Phase 4 flow. */
async function persistedRecord(): Promise<LeadIntelligenceRecord> {
  const store = createInMemoryIntelligenceStore();
  const orchestrator = createLeadIntelligenceOrchestrator({
    persistence: store,
    snapshotSource: { load: async () => baseRows() },
    clock: () => T0,
  });
  const result = await orchestrator.generate(REF);
  return result.record!;
}

const spyPort = (record: LeadIntelligenceRecord | null) => {
  const get = jest.fn(async () => record);
  const upsert = jest.fn();
  const markRebuildRequested = jest.fn();
  return { port: { get, upsert, markRebuildRequested }, get, upsert, markRebuildRequested };
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

const VIEW_KEYS = [
  'companyId', 'leadId', 'status', 'freshness', 'version', 'overallConfidence',
  'intent', 'persona', 'qualification', 'segments', 'recommendations', 'timeline',
  'qualificationPlanning', 'automationPlanning', // INT-002 Wave 2 additive layers
].sort();

const LIST_ITEM_KEYS = [
  'leadId', 'status', 'freshness', 'overallScore', 'qualificationBand', 'intentBand',
  'primaryPersona', 'primarySegment', 'topAction', 'confidence', 'generatedAt', 'engineVersion',
].sort();

describe('INT-001 Phase 6 — canonical read service', () => {
  it('exposes existing intelligence fully normalized, with version + fingerprint', async () => {
    const record = await persistedRecord();
    const { port } = spyPort(record);
    const api = createLeadIntelligenceReadApi({ persistence: port });
    const view = await api.getLeadIntelligenceView('co1', 'L1');

    expect(view.status).toBe('available');
    expect(view.freshness).toBe('fresh');
    expect(view.version).toEqual({
      engineVersion: ENGINE_VERSION,
      schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      generation: 1,
      fingerprint: record.inputFingerprint,
      generatedAt: NOW_ISO,
    });
    expect(view.version!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(view.intent!.score).toBe(record.intelligence.intent.score);
    expect(view.persona!.persona).toBe('CTO');
    expect(view.qualification!.sections.map((s) => s.key)).toEqual(['intent', 'persona', 'companyFit', 'behavior', 'urgency']);
    expect(view.segments.length).toBeGreaterThan(0);
    expect(view.recommendations.length).toBe(10);
    expect(view.timeline.length).toBe(record.intelligence.timeline.length);
    expect(view.overallConfidence).toBe(record.intelligence.confidence);
  });

  it('missing intelligence → never_generated view with empty sections (never null result)', async () => {
    const { port } = spyPort(null);
    const api = createLeadIntelligenceReadApi({ persistence: port });
    const view = await api.getLeadIntelligenceView('co1', 'absent');
    expect(view).toEqual({
      companyId: 'co1',
      leadId: 'absent',
      status: 'never_generated',
      freshness: 'never_generated',
      version: null,
      overallConfidence: null,
      intent: null,
      persona: null,
      qualification: null,
      segments: [],
      recommendations: [],
      timeline: [],
      qualificationPlanning: null,
      automationPlanning: null,
    });
  });

  it('a throwing persistence read fails open to never_generated', async () => {
    const api = createLeadIntelligenceReadApi({
      persistence: { get: async () => { throw new Error('table missing'); } },
    });
    const view = await api.getLeadIntelligenceView('co1', 'L1');
    expect(view.status).toBe('never_generated');
  });

  it('read-only guarantee: only get() is called and the record is never mutated', async () => {
    const record = deepFreeze(await persistedRecord());
    const { port, get, upsert, markRebuildRequested } = spyPort(record);
    const api = createLeadIntelligenceReadApi({ persistence: port });

    const view = await api.getLeadIntelligenceView('co1', 'L1');
    await api.getLeadIntelligenceListItems('co1', ['L1']);
    toLeadIntelligenceListItem(view); // helpers select only

    expect(get).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(markRebuildRequested).not.toHaveBeenCalled();
  });

  it('bulk views preserve input order, map 1:1 and are capped', async () => {
    const record = await persistedRecord();
    const api = createLeadIntelligenceReadApi({
      persistence: { get: async (_c, leadId) => (leadId === 'L1' ? record : null) },
    });
    const views = await api.getLeadIntelligenceViews('co1', ['zz', 'L1', 'aa']);
    expect(views.map((v) => v.leadId)).toEqual(['zz', 'L1', 'aa']);
    expect(views.map((v) => v.status)).toEqual(['never_generated', 'available', 'never_generated']);

    const many = await api.getLeadIntelligenceViews('co1', Array.from({ length: 500 }, (_, i) => `L${i}`));
    expect(many).toHaveLength(200);
  });

  it('is deterministic — repeated reads produce identical DTO JSON', async () => {
    const record = await persistedRecord();
    const { port } = spyPort(record);
    const api = createLeadIntelligenceReadApi({ persistence: port });
    const a = await api.getLeadIntelligenceView('co1', 'L1');
    const b = await api.getLeadIntelligenceView('co1', 'L1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('INT-001 Phase 6 — freshness & version exposure', () => {
  it('exposes stale, pending_regeneration and never_generated exactly as stored', async () => {
    const record = await persistedRecord();
    const stale = toLeadIntelligenceView({ ...record, engineVersion: 'lie-0.1.0' }, REF);
    expect(stale.freshness).toBe('stale');
    expect(stale.version!.engineVersion).toBe('lie-0.1.0'); // as persisted, no inference

    const pending = toLeadIntelligenceView({ ...record, rebuildRequestedAt: NOW_ISO }, REF);
    expect(pending.freshness).toBe('pending_regeneration');

    const never = toLeadIntelligenceView(null, REF);
    expect(never.freshness).toBe('never_generated');

    const fresh = toLeadIntelligenceView(record, REF);
    expect(fresh.freshness).toBe('fresh');
  });

  it('describeFreshness labels every state without inference', () => {
    const states: IntelligenceFreshness[] = ['fresh', 'stale', 'pending_regeneration', 'never_generated'];
    const tones = states.map((s) => describeFreshness(s));
    expect(tones.map((t) => t.state)).toEqual(states);
    expect(tones.map((t) => t.tone)).toEqual(['positive', 'warning', 'info', 'neutral']);
    for (const t of tones) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe('INT-001 Phase 6 — tolerant normalization', () => {
  it('partial intelligence: absent sections degrade to null/empty without throwing', async () => {
    const record = await persistedRecord();
    const partial: LeadIntelligenceRecord = {
      ...record,
      intelligence: {
        confidence: 0.4,
        intent: record.intelligence.intent,
      } as unknown as LeadIntelligenceRecord['intelligence'],
    };
    const view = toLeadIntelligenceView(partial, REF);
    expect(view.status).toBe('available');
    expect(view.intent!.score).toBe(record.intelligence.intent.score);
    expect(view.persona).toBeNull();
    expect(view.qualification).toBeNull();
    expect(view.segments).toEqual([]);
    expect(view.recommendations).toEqual([]);
    expect(view.timeline).toEqual([]);
  });

  it('malformed intelligence: wrong-typed sections are dropped, valid ones kept', async () => {
    const record = await persistedRecord();
    const malformed: LeadIntelligenceRecord = {
      ...record,
      intelligence: {
        confidence: 'high', // wrong type
        intent: 'not-an-object',
        persona: { persona: 'CTO' }, // missing confidence
        qualification: { totalScore: 66, band: 'warm', sections: [{ bad: true }, { key: 'intent', score: 60, weight: 0.35, weightedScore: 21, reason: 'r' }] },
        segments: [{ segment: 'Decision Makers', confidence: 0.7, reasons: ['r'] }, { nope: 1 }],
        recommendations: { nextBestAction: { value: 'Call now', confidence: 0.8, explanation: 'hot' }, bestChannel: 'oops' },
        timeline: [{ type: 'page_view', label: 'Pricing', occurredAt: '2026-08-03T10:00:00.000Z', pageUrl: '/pricing', category: 'pricing', source: 'tracking' }, { type: 'broken' }],
      } as unknown as LeadIntelligenceRecord['intelligence'],
    };
    const view = toLeadIntelligenceView(malformed, REF);
    expect(view.overallConfidence).toBeNull();
    expect(view.intent).toBeNull();
    expect(view.persona).toBeNull();
    expect(view.qualification!.totalScore).toBe(66);
    expect(view.qualification!.sections).toHaveLength(1); // invalid section dropped
    expect(view.segments).toEqual([{ segment: 'Decision Makers', confidence: 0.7, reasons: ['r'] }]);
    expect(view.recommendations.map((r) => r.key)).toEqual(['nextBestAction']); // malformed bestChannel dropped
    expect(view.timeline).toHaveLength(1);
  });

  it('legacy persisted rows surface with unknown engine version and stale freshness', () => {
    const legacy = rowToIntelligenceRecord({
      company_id: 'co1',
      lead_id: 'L1',
      intelligence: { confidence: 0.5 },
    });
    const view = toLeadIntelligenceView(legacy, REF);
    expect(view.status).toBe('available');
    expect(view.freshness).toBe('stale'); // engine-version mismatch, as stored
    expect(view.version!.engineVersion).toBe('unknown');
    expect(view.overallConfidence).toBe(0.5);
    expect(view.intent).toBeNull();
  });

  it('DTO shape is stable (exact key sets — schema never leaks)', async () => {
    const record = await persistedRecord();
    const available = toLeadIntelligenceView(record, REF);
    const never = toLeadIntelligenceView(null, REF);
    expect(Object.keys(available).sort()).toEqual(VIEW_KEYS);
    expect(Object.keys(never).sort()).toEqual(VIEW_KEYS);
    expect(Object.keys(toLeadIntelligenceListItem(available)).sort()).toEqual(LIST_ITEM_KEYS);
    expect(Object.keys(available.version!).sort()).toEqual(['engineVersion', 'fingerprint', 'generatedAt', 'generation', 'schemaVersion']);
  });
});

describe('INT-001 Phase 6 — presentation helpers (selection only)', () => {
  let view: LeadIntelligenceViewDTO;
  beforeAll(async () => {
    view = toLeadIntelligenceView(await persistedRecord(), REF);
  });

  it('selects score, band, persona and primary segment from persisted values', () => {
    expect(overallScoreOf(view)).toBe(view.qualification!.totalScore);
    expect(qualificationBandOf(view)).toBe(view.qualification!.band);
    expect(primaryPersonaOf(view)!.persona).toBe('CTO');
    // Segments are persisted confidence-desc; the primary is the stored max.
    const expectedMax = Math.max(...view.segments.map((s) => s.confidence));
    expect(primarySegmentOf(view)!.confidence).toBe(expectedMax);
  });

  it('primary segment tiebreak is lexicographic and deterministic', () => {
    const tied: LeadIntelligenceViewDTO = {
      ...view,
      segments: [
        { segment: 'Researchers', confidence: 0.5, reasons: [] },
        { segment: 'Decision Makers', confidence: 0.5, reasons: [] },
      ],
    };
    expect(primarySegmentOf(tied)!.segment).toBe('Decision Makers');
  });

  it('exposes top action and highest-confidence channel from persisted recommendations', () => {
    const action = topActionOf(view)!;
    expect(action.key).toBe('nextBestAction');
    expect(action.value).toBe(view.recommendations.find((r) => r.key === 'nextBestAction')!.value);

    const channel = highestConfidenceChannelOf(view)!;
    expect(channel.key).toBe('bestChannel');
    expect(typeof channel.value).toBe('string');
  });

  it('recommendation preview orders by persisted confidence with stable tiebreak', () => {
    const preview = recommendationPreviewOf(view, 3);
    expect(preview).toHaveLength(3);
    for (let i = 1; i < preview.length; i += 1) {
      expect(preview[i - 1].confidence).toBeGreaterThanOrEqual(preview[i].confidence);
    }
    const top = topRecommendationOf(view)!;
    expect(preview[0]).toEqual(top);
    // Ties resolve by stable DTO order — same input, same output.
    expect(recommendationPreviewOf(view, 3)).toEqual(preview);
  });

  it('timeline preview returns the most recent N entries in persisted order', () => {
    const preview = timelinePreviewOf(view, 2);
    expect(preview).toEqual(view.timeline.slice(-2));
    expect(timelinePreviewOf(view, 0)).toEqual([]);
    expect(timelinePreviewOf({ ...view, timeline: [] }, 5)).toEqual([]);
  });

  it('confidence summary selects persisted values only', () => {
    expect(confidenceSummaryOf(view)).toEqual({
      overall: view.overallConfidence,
      persona: view.persona!.confidence,
      intentBand: view.intent!.band,
      qualificationBand: view.qualification!.band,
    });
    const empty = confidenceSummaryOf(toLeadIntelligenceView(null, REF));
    expect(empty).toEqual({ overall: null, persona: null, intentBand: null, qualificationBand: null });
  });
});

describe('INT-001 Phase 6 — list projection & aggregation', () => {
  it('list vs detail parity: every list field equals the detail selection', async () => {
    const record = await persistedRecord();
    const view = toLeadIntelligenceView(record, REF);
    const item = toLeadIntelligenceListItem(view);
    expect(item).toEqual({
      leadId: view.leadId,
      status: view.status,
      freshness: view.freshness,
      overallScore: overallScoreOf(view),
      qualificationBand: qualificationBandOf(view),
      intentBand: view.intent!.band,
      primaryPersona: primaryPersonaOf(view)!.persona,
      primarySegment: primarySegmentOf(view)!.segment,
      topAction: topActionOf(view)!.value,
      confidence: view.overallConfidence,
      generatedAt: NOW_ISO,
      engineVersion: ENGINE_VERSION,
    });
  });

  it('aggregates counts and average of persisted scores (read-only aggregation)', async () => {
    const record = await persistedRecord();
    const available = toLeadIntelligenceView(record, REF);
    const stale = toLeadIntelligenceView({ ...record, engineVersion: 'old' }, { companyId: 'co1', leadId: 'L2' });
    const never = toLeadIntelligenceView(null, { companyId: 'co1', leadId: 'L3' });

    const agg = aggregateIntelligenceViews([available, stale, never]);
    expect(agg.total).toBe(3);
    expect(agg.available).toBe(2);
    expect(agg.byFreshness).toEqual({ fresh: 1, stale: 1, pending_regeneration: 0, never_generated: 1 });
    const band = available.qualification!.band;
    expect(agg.byBand[band]).toBe(2);
    expect(agg.averageScore).toBe(available.qualification!.totalScore); // both scores identical

    expect(aggregateIntelligenceViews([])).toEqual({
      total: 0,
      available: 0,
      byFreshness: { fresh: 0, stale: 0, pending_regeneration: 0, never_generated: 0 },
      byBand: {},
      averageScore: null,
    });
  });
});
