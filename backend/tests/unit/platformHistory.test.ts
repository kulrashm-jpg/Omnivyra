/**
 * Phase 37 — Historical Intelligence (snapshot persistence + trend + anomaly). All
 * deterministic, written from already-composed snapshots, Unknown with insufficient history.
 */
import { __resetSnapshotStore, latestSnapshot, previousSnapshot } from '../../services/platformIntelligence/history/platformSnapshotRepository';
import { persistSnapshots, toHistoricalSnapshot } from '../../services/platformIntelligence/history/platformSnapshotWriter';
import { getHistory, historicalScores } from '../../services/platformIntelligence/history/platformHistoryService';
import { computeTrend } from '../../services/platformIntelligence/history/platformTrendEngine';
import { detectAnomalies } from '../../services/platformIntelligence/history/platformAnomalyEngine';
import type { PluginSnapshot } from '../../services/platformIntelligence/registry';

const snap = (id: string, score: number, recs = 1, stale = false, maturity = 60, conf = 0.7): PluginSnapshot => ({
  id, domain: id, displayName: id, health: { overall: score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'disconnected', score },
  modules: [
    { key: 'x', label: 'X', status: 'partial', available: true, source: 's', lastUpdated: null, score },
    { key: `${id}_maturity`, label: 'M', status: 'partial', available: true, source: 's', lastUpdated: null, score: maturity },
  ],
  recommendations: Array.from({ length: recs }, (_, i) => ({ key: `r${i}`, recommendation: `r${i}`, source: 's', originEngine: 's', category: 'medium', priority: 50, reason: '', affectedModules: [], estimatedImpact: 'medium', businessImpact: 'medium', estimatedEffort: 'low', estimatedROI: 'medium', impact: { dimensions: {}, cascade: [], summary: '', score: 0 }, dependencies: [], confidence: 0.7 } as any)),
  businessImpact: { dimensions: {}, topDimensions: ['revenue'], summary: 's' } as any,
  executiveSummary: {} as any, roadmap: [], confidence: conf, freshness: { lastEvaluatedAt: '2026-06-01T00:00:00Z', stale },
});

beforeEach(() => __resetSnapshotStore());

describe('Phase 37 — snapshot persistence', () => {
  it('persists composed snapshots + retrieves them oldest→newest', async () => {
    await persistSnapshots('co1', [snap('website', 50)], '2026-06-01T00:00:00Z');
    await persistSnapshots('co1', [snap('website', 60)], '2026-06-02T00:00:00Z');
    expect((await getHistory('co1', 'website')).map((s) => s.overallScore)).toEqual([50, 60]);
    expect((await latestSnapshot('co1', 'website'))!.overallScore).toBe(60);
    expect((await previousSnapshot('co1', 'website'))!.overallScore).toBe(50);
    expect(await historicalScores('co1', 'website')).toEqual([50, 60]);
  });
  it('writer maps maturity + recommendation ids without recompute', () => {
    const h = toHistoricalSnapshot(snap('lead', 70, 3, false, 80), 'co1', '2026-06-01T00:00:00Z');
    expect(h.maturity).toBe(80);
    expect(h.recommendationIds).toHaveLength(3);
    expect(h.overallScore).toBe(70);
  });
});

describe('Phase 37 — trend engine', () => {
  it('Unknown with insufficient history', () => {
    const t = computeTrend([50]);
    expect(t.delta).toBeNull(); expect(t.direction).toBe('unknown');
  });
  it('improvement / direction / momentum', () => {
    const t = computeTrend([40, 50, 60, 70]);
    expect(t.improvement).toBe(true); expect(t.direction).toBe('up'); expect(t.delta).toBe(30); expect(t.momentum!).toBeGreaterThan(0);
  });
  it('regression', () => { const t = computeTrend([80, 70, 60]); expect(t.regression).toBe(true); expect(t.direction).toBe('down'); });
  it('recovery', () => { expect(computeTrend([60, 40, 55, 65]).recovery).toBe(true); });
  it('plateau', () => { expect(computeTrend([50, 70, 71, 70]).plateau).toBe(true); });
  it('deterministic', () => { expect(computeTrend([40, 50, 60])).toEqual(computeTrend([40, 50, 60])); });
});

describe('Phase 37 — anomaly engine', () => {
  it('no anomaly with insufficient history', () => { expect(detectAnomalies([])).toEqual([]); });
  it('detects sudden drop + confidence collapse + freshness anomaly', () => {
    const rows = [
      toHistoricalSnapshot(snap('website', 80, 1, false, 60, 0.8), 'co1', '2026-06-01T00:00:00Z'),
      toHistoricalSnapshot(snap('website', 60, 1, true, 60, 0.4), 'co1', '2026-06-02T00:00:00Z'),
    ];
    const a = detectAnomalies(rows).map((x) => x.kind);
    expect(a).toEqual(expect.arrayContaining(['sudden_drop', 'confidence_collapse', 'freshness_anomaly']));
  });
  it('detects recommendation explosion', () => {
    const rows = [toHistoricalSnapshot(snap('lead', 60, 2), 'co1', 't1'), toHistoricalSnapshot(snap('lead', 60, 5), 'co1', 't2')];
    expect(detectAnomalies(rows).some((x) => x.kind === 'recommendation_explosion')).toBe(true);
  });
});
