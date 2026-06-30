/**
 * Phase 36 — Predictive Intelligence (Plugin #13). Deterministic forecast scorer (evidence-
 * derived from the conversion-prediction distribution; Unknown for trend/momentum that needs
 * historical time-series) + platform composition + report auto-discovery.
 */
import { scorePredictiveIntelligence } from '../../services/predictiveIntelligence/predictiveIntelligenceEngine';
import { predictiveIntelligencePlugin } from '../../services/predictiveIntelligence/predictiveIntelligencePlugin';
import { composePluginSnapshot, toPresentationModel, getPluginsForReport } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const inputs = {
  conversion: { generatedAt: '2026-06-01T00:00:00Z', distribution: { high: 6, medium: 8, low: 4, cold: 2 } },
  growth: { growthScore: 62, opportunities: { campaignsFromOpportunities: 3 } },
  cohort: { totalRevenueUsd: 7000 },
  leadStats: { total: 20, intentBands: { high: 6, medium: 8, low: 6 } },
  readiness: { generatedAt: '2026-06-01T00:00:00Z', checks: [{ id: 'cms', done: true }, { id: 'analytics', done: true }, { id: 'leads', done: false }] },
};

describe('Phase 36 — Predictive Intelligence scorer', () => {
  it('derives forecasts from the conversion-prediction distribution; trend/momentum Unknown', () => {
    const r = scorePredictiveIntelligence(inputs as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('conversion_forecast').available).toBe(true);
    expect(m('pipeline_forecast').available).toBe(true); // (high+medium) projected
    expect(m('marketing_outlook').score).toBe(62); // current-health proxy
    expect(m('business_momentum').available).toBe(false); // Unknown — needs historical snapshots
    expect(m('website_trend').available).toBe(false); // Unknown
    expect(m('growth_direction').available).toBe(false); // Unknown
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_historical_snapshots')).toBe(true);
  });

  it('is Unknown with no forward-looking evidence', () => {
    const r = scorePredictiveIntelligence({ conversion: null, growth: null, cohort: null, leadStats: null, readiness: null } as any);
    expect(r.modules.find((x) => x.key === 'conversion_forecast')!.available).toBe(false);
    expect(r.modules.find((x) => x.key === 'predictive_health')!.available).toBe(false);
    expect(r.recommendationInputs.some((i) => i.key === 'increase_prediction_sample')).toBe(true);
  });

  it('composes through the platform engines and is report-discoverable (decision/unified auto-consume)', async () => {
    const spy = jest.spyOn(predictiveIntelligencePlugin, 'provide').mockResolvedValue({
      modules: scorePredictiveIntelligence(inputs as any).modules, recommendationInputs: scorePredictiveIntelligence(inputs as any).recommendationInputs, score: 55, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(predictiveIntelligencePlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Business trajectory scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'predictive_intelligence')).toBe(true);
  });
});
