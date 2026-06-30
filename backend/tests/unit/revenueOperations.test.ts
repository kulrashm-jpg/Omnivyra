/**
 * Phase 29 — Revenue Operations on the Platform Intelligence Framework. Deterministic
 * efficiency scorer (evidence-backed; Unknown stays Unknown) + plugin composition + report
 * auto-discovery (Decision auto-includes it via the registry, no Decision edits).
 */
import { scoreRevenueOperations } from '../../services/revenueOperations/revenueOperationsEngine';
import { revenueOperationsPlugin } from '../../services/revenueOperations/revenueOperationsPlugin';
import { composePluginSnapshot, toPresentationModel, getPluginsForReport } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const inputs = {
  journey: { attributionBreakRate: 0.4, bottleneck: 'lead→opportunity', generatedAt: '2026-06-01T00:00:00Z' },
  attribution: { generatedAt: '2026-06-01T00:00:00Z', totals: { leads: 20, leadsWithAttribution: 14, leadsWithSession: 8 } },
  cohort: { totalRevenueUsd: 6000, attributionBreakRate: 0.4, cohorts: [{ stages: [{ stage: 'opportunity', count: 6 }, { stage: 'closed_won', count: 3 }], bottleneckStage: 'lead→opportunity' }] },
  conversion: { distribution: { high: 3, medium: 5, low: 8, cold: 4 } },
  leadStats: { total: 20, intentBands: { high: 3, medium: 6, low: 11 } },
};

describe('Phase 29 — Revenue Operations scorer', () => {
  it('measures efficiency from real handoff/leakage/bottleneck evidence', () => {
    const r = scoreRevenueOperations(inputs as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('marketing_sales_handoff').score).toBe(40); // 8/20 session-linked
    expect(m('revenue_leakage').score).toBe(60); // 100 - 40% break
    expect(m('operational_bottlenecks').findings[0]).toContain('lead→opportunity');
    expect(m('sales_velocity').available).toBe(false); // Unknown — no timestamps
    expect(r.recommendationInputs.some((i) => i.key === 'fix_revenue_leakage')).toBe(true);
    expect(r.recommendationInputs.some((i) => i.key === 'resolve_bottleneck')).toBe(true);
  });

  it('composes through the platform engines and is report-discoverable', async () => {
    const spy = jest.spyOn(revenueOperationsPlugin, 'provide').mockResolvedValue({
      modules: scoreRevenueOperations(inputs as any).modules, recommendationInputs: scoreRevenueOperations(inputs as any).recommendationInputs, score: 50, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(revenueOperationsPlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Revenue operations scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'revenue_operations')).toBe(true);
  });
});
