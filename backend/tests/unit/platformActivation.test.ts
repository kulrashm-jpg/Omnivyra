/**
 * Phase 39 — Historical Intelligence production activation. Proves the durable store maps the
 * table both ways, the snapshot job composes each plugin once + persists once (memoization
 * preserved), the scheduler runs, and trend activates over persisted history (predictive
 * activation) — all without touching plugins/registry/reports/dashboards.
 */
const builderRows: any[] = [];
const builder: any = {
  insert: jest.fn(async (rows: any[]) => { builderRows.push(...rows); return { error: null }; }),
  select: jest.fn(() => builder), eq: jest.fn(() => builder),
  order: jest.fn(() => builder), limit: jest.fn(async () => ({ data: builderRows, error: null })),
};
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => builder }));

import { SupabaseSnapshotStore } from '../../services/platformIntelligence/history/supabaseSnapshotStore';
import { runPlatformSnapshotJob } from '../../services/platformIntelligence/history/platformSnapshotJob';
import { __resetSnapshotStore } from '../../services/platformIntelligence/history/platformSnapshotRepository';
import { persistSnapshots } from '../../services/platformIntelligence/history/platformSnapshotWriter';
import { getHistory, historicalScores } from '../../services/platformIntelligence/history/platformHistoryService';
import { computeTrend } from '../../services/platformIntelligence/history/platformTrendEngine';
import type { IntelligencePlugin, PluginSnapshot } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const histSnap = (score: number): PluginSnapshot => ({
  id: 'predictive_intelligence', domain: 'predictive', displayName: 'P', health: { overall: 'warning', score },
  modules: [{ key: 'x', label: 'X', status: 'partial', available: true, source: 's', lastUpdated: null, score }],
  recommendations: [], businessImpact: { dimensions: {}, topDimensions: ['revenue'], summary: 's' } as any,
  executiveSummary: {} as any, roadmap: [], confidence: 0.7, freshness: { lastEvaluatedAt: null, stale: false },
});

describe('Phase 39 — durable SnapshotStore', () => {
  beforeEach(() => { builderRows.length = 0; builder.insert.mockClear(); });
  it('saves + lists round-trip via the table (mapping both ways)', async () => {
    const store = new SupabaseSnapshotStore();
    await store.save([{ companyId: 'co1', takenAt: '2026-06-01T00:00:00Z', pluginId: 'website', overallScore: 70, health: 'warning', confidence: 0.7, freshness: { lastEvaluatedAt: null, stale: false }, maturity: 60, businessImpact: { topDimensions: ['revenue'], summary: 's' }, recommendationIds: ['r1'], moduleSummaries: [{ key: 'm', score: 70, status: 'partial' }], metadata: {} }]);
    expect(builder.insert).toHaveBeenCalledTimes(1);
    const out = await store.list('co1', 'website');
    expect(out[0]!.overallScore).toBe(70);
    expect(out[0]!.recommendationIds).toEqual(['r1']);
  });
});

describe('Phase 39 — snapshot job + activation', () => {
  beforeEach(() => __resetSnapshotStore());
  it('composes each plugin once + persists once (memoization preserved)', async () => {
    const provideA = jest.fn(async () => ({ modules: [{ key: 'a', label: 'A', status: 'partial' as const, available: true, source: 's', lastUpdated: null, score: 50 }], recommendationInputs: [], score: 50, lastUpdated: null }));
    const provideB = jest.fn(async () => ({ modules: [{ key: 'b', label: 'B', status: 'partial' as const, available: true, source: 's', lastUpdated: null, score: 60 }], recommendationInputs: [], score: 60, lastUpdated: null }));
    const cfg = (id: string, spy: jest.Mock): IntelligencePlugin => ({ id, displayName: id, domain: id, entityLabel: id, supportedReports: ['snapshot'], supportedDashboards: [], impactConfig: { graph: {}, moduleDimensions: {}, dimensionTail: {} as any }, provide: spy as any });
    const res = await runPlatformSnapshotJob('co1', { nowMs: NOW, plugins: [cfg('pa', provideA), cfg('pb', provideB)] });
    expect(res.pluginsComposed).toBe(2);
    expect(res.snapshotsPersisted).toBe(2);
    expect(provideA).toHaveBeenCalledTimes(1);
    expect(provideB).toHaveBeenCalledTimes(1);
    expect(res.errors).toEqual([]);
    expect((await getHistory('co1', 'pa')).length).toBe(1);
  });

  it('predictive activation: trend computes over persisted history (no plugin edits)', async () => {
    await persistSnapshots('co1', [histSnap(40)], '2026-06-01T00:00:00Z');
    await persistSnapshots('co1', [histSnap(55)], '2026-06-02T00:00:00Z');
    await persistSnapshots('co1', [histSnap(70)], '2026-06-03T00:00:00Z');
    const t = computeTrend(await historicalScores('co1', 'predictive_intelligence'));
    expect(t.direction).toBe('up');
    expect(t.improvement).toBe(true);
    expect(t.momentum!).toBeGreaterThan(0);
  });
});
