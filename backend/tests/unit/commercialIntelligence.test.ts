/**
 * Phase 23 — Commercial / Revenue Intelligence on the Platform Intelligence Framework.
 * Tests the deterministic domain scorer (evidence-backed; Unknown stays Unknown) + that the
 * plugin composes through the platform engines (registry).
 */
import { scoreCommercialIntelligence } from '../../services/commercialIntelligence/commercialIntelligenceEngine';
import { commercialIntelligencePlugin } from '../../services/commercialIntelligence/commercialIntelligencePlugin';
import { composePluginSnapshot, toPresentationModel } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');

const withRevenue = {
  cohort: { generatedAt: '2026-06-01T00:00:00Z', totalRevenueUsd: 12000, attributionBreakRate: 0.1, cohorts: [{ stages: [{ stage: 'lead', count: 20 }, { stage: 'opportunity', count: 6 }, { stage: 'closed_won', count: 3 }] }] },
  conversion: { distribution: { high: 4, medium: 6, low: 8, cold: 2 } },
  journey: { attributionBreakRate: 0.1, bottleneck: 'organic:search' },
  attribution: { generatedAt: '2026-06-01T00:00:00Z', totals: { leads: 20, leadsWithAttribution: 16 }, channelBreakdown: { organic_search: 10, direct: 6 }, campaignBreakdown: { spring: 8 } },
  leadStats: { total: 20, intentBands: { high: 4, medium: 6, low: 10 } },
};

describe('Phase 23 — Commercial Intelligence scorer', () => {
  it('scores real revenue/funnel/forecast evidence', () => {
    const r = scoreCommercialIntelligence(withRevenue as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('revenue_health').available).toBe(true); // revenue lineage present
    expect(m('sales_health').score).toBe(50); // 3/6 won
    expect(m('forecast_health').available).toBe(true);
    expect(m('revenue_confidence').score).toBe(80); // 16/20 attributed
    expect(r.maturityLevel).toBe(5); // leads+qualified+opps+revenue+attribution
  });

  it('keeps Unknown unknown when there is no revenue lineage or capacity data', () => {
    const r = scoreCommercialIntelligence({ ...withRevenue, cohort: { generatedAt: null, totalRevenueUsd: 0, attributionBreakRate: 0.1, cohorts: [] } } as any);
    expect(r.modules.find((x) => x.key === 'revenue_health')!.available).toBe(false); // Unknown
    expect(r.modules.find((x) => x.key === 'sales_capacity')!.available).toBe(false); // always Unknown
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_revenue_lineage')).toBe(true);
  });

  it('composes through the platform engines via the registry', async () => {
    const spy = jest.spyOn(commercialIntelligencePlugin, 'provide').mockResolvedValue({
      modules: scoreCommercialIntelligence(withRevenue as any).modules, recommendationInputs: scoreCommercialIntelligence(withRevenue as any).recommendationInputs, score: 62, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(commercialIntelligencePlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Commercial & Revenue scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
