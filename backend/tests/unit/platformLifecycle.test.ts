/**
 * Phase 40 — Autonomous Intelligence Lifecycle. Change detection, root cause, alerts (dedup +
 * resolved suppression), priority ordering, evidence-cited insights, determinism — all from
 * persisted HistoricalSnapshots only (no plugin execution).
 */
import { detectChanges, detectChangesForHistory } from '../../services/platformIntelligence/lifecycle/platformChangeEngine';
import { analyzeRootCause } from '../../services/platformIntelligence/lifecycle/platformRootCauseEngine';
import { buildLifecycle } from '../../services/platformIntelligence/lifecycle/platformLifecycleEngine';
import { generateAlerts, alertsForHistory } from '../../services/platformIntelligence/lifecycle/platformAlertEngine';
import { insightsForHistory } from '../../services/platformIntelligence/lifecycle/platformInsightEngine';
import type { HistoricalSnapshot } from '../../services/platformIntelligence/history/platformSnapshotTypes';

const snap = (pluginId: string, takenAt: string, o: { score: number; health: string; confidence?: number; recs?: string[]; stale?: boolean; dims?: string[] }): HistoricalSnapshot => ({
  companyId: 'co1', takenAt, pluginId, overallScore: o.score, health: o.health, confidence: o.confidence ?? 0.7,
  freshness: { lastEvaluatedAt: takenAt, stale: o.stale ?? false }, maturity: 60,
  businessImpact: { topDimensions: o.dims ?? ['revenue'], summary: 's' }, recommendationIds: o.recs ?? [],
  moduleSummaries: [{ key: 'm', score: o.score, status: 'partial' }], metadata: {},
});

describe('Phase 40 — change + root cause', () => {
  const prev = snap('website', '2026-06-01T00:00:00Z', { score: 80, health: 'healthy', confidence: 0.8, recs: [] });
  const cur = snap('website', '2026-06-02T00:00:00Z', { score: 55, health: 'warning', confidence: 0.6, recs: ['fix_x'] });
  it('detects score decrease, new issue, recommendation added, confidence drop', () => {
    const kinds = detectChanges(prev, cur).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['score_decrease', 'new_issue', 'recommendation_added', 'confidence_decrease']));
  });
  it('root cause ranks the largest-magnitude negative as primary', () => {
    const rc = analyzeRootCause(detectChanges(prev, cur), { website: ['revenue'] });
    expect(rc.primaryPlugin).toBe('website');
    expect(rc.primaryCause).toContain('Score fell');
    expect(rc.affectedDimensions).toContain('revenue');
    expect(rc.confidence).toBeGreaterThan(0.4);
  });
  it('Unknown root cause when no negatives', () => {
    const rc = analyzeRootCause([]);
    expect(rc.primaryCause).toBeNull(); expect(rc.confidence).toBe(0);
  });
});

describe('Phase 40 — alerts', () => {
  it('emits critical for a large drop + dedupes by kind+plugin', () => {
    const rows = [snap('lead', 't1', { score: 80, health: 'healthy' }), snap('lead', 't2', { score: 55, health: 'warning' })];
    const a = alertsForHistory(rows);
    expect(a.some((x) => x.level === 'critical')).toBe(true);
    expect(new Set(a.map((x) => `${x.kind}|${x.pluginId}`)).size).toBe(a.length); // no duplicates
  });
  it('suppresses negative alerts once the issue is resolved', () => {
    const rows = [snap('lead', 't1', { score: 50, health: 'warning', confidence: 0.8 }), snap('lead', 't2', { score: 70, health: 'healthy', confidence: 0.6 })];
    const a = alertsForHistory(rows);
    expect(a.some((x) => x.kind === 'confidence_decrease')).toBe(false); // negative dropped (health resolved)
    expect(a.some((x) => x.kind === 'resolved_issue')).toBe(true);
  });
});

describe('Phase 40 — lifecycle priority + insights + determinism', () => {
  const timeline = [
    snap('website', 't1', { score: 80, health: 'healthy' }), snap('website', 't2', { score: 78, health: 'healthy' }),
    snap('lead', 't1', { score: 80, health: 'healthy' }), snap('lead', 't2', { score: 50, health: 'warning' }),
  ];
  it('orders priorities by magnitude (biggest drop first)', () => {
    const lc = buildLifecycle(timeline);
    expect(lc.records[0]!.pluginId).toBe('lead');
    expect(lc.records[0]!.urgency).toBe('immediate');
    expect(lc.rootCause.primaryPlugin).toBe('lead');
  });
  it('insights cite evidence and never invent with insufficient history', () => {
    expect(insightsForHistory([snap('p', 't1', { score: 50, health: 'warning' })])).toEqual([]);
    const ins = insightsForHistory([snap('p', 't1', { score: 40, health: 'warning' }), snap('p', 't2', { score: 55, health: 'warning' }), snap('p', 't3', { score: 70, health: 'healthy' })]);
    expect(ins[0]!.kind).toBe('improved');
    expect(ins[0]!.evidence).toEqual({ first: 40, last: 70, delta: 30, points: 3 });
  });
  it('is deterministic and history-only (no changes with <2 snapshots)', () => {
    expect(detectChangesForHistory([snap('p', 't1', { score: 50, health: 'warning' })])).toEqual([]);
    expect(generateAlerts(timeline)).toEqual(generateAlerts(timeline));
    expect(buildLifecycle(timeline).records).toEqual(buildLifecycle(timeline).records);
  });
});
