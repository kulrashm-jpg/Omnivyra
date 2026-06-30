/**
 * Phase 22 — Marketing & Growth domain on the Platform Intelligence Framework. Tests the
 * deterministic domain scorer (pure, evidence-backed, Unknown stays Unknown) + that the
 * plugin composes through the platform engines (registry).
 */
import { scoreMarketingGrowth } from '../../services/marketingGrowth/marketingGrowthEngine';
import { marketingGrowthPlugin } from '../../services/marketingGrowth/marketingGrowthPlugin';
import { composePluginSnapshot, toPresentationModel } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const inputs = {
  growth: { growthScore: 55, scoreBreakdown: { contentVelocity: 8, publishing: 20, engagement: 12, community: 4, opportunity: 3 } },
  leadStats: { total: 20, intentBands: { high: 2, medium: 6, low: 12 }, withIdentity: 8, withCampaign: 5 },
  website: { health: { compositeScore: 70, computedAt: '2026-06-01T00:00:00Z', categoryScores: { integration_reliability: 80 } }, tracking: { active: true }, domain: { verified: true }, modules: [{ key: 'seo', status: 'ready' }, { key: 'brand', status: 'partial' }, { key: 'competitive', status: 'ready' }, { key: 'marketpulse', status: 'partial' }] },
  readiness: { generatedAt: '2026-06-01T00:00:00Z', checks: [{ id: 'cms', done: true }, { id: 'analytics', done: false }, { id: 'leads', done: false }] },
};

describe('Phase 22 — Marketing & Growth scorer', () => {
  it('scores evidenced dimensions and keeps Unknown unknown', () => {
    const r = scoreMarketingGrowth(inputs as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('website').score).toBe(70);
    expect(m('seo').score).toBe(85); // ready module
    expect(m('revenue').available).toBe(false); // Unknown — no spend/revenue evidence
    expect(m('channel_paid').available).toBe(false); // no paid-channel data
    expect(m('funnel').score).toBe(10); // 2/20 qualified
    expect(typeof r.maturityLevel).toBe('number');
    expect(r.recommendationInputs.some((i) => i.key === 'enable_lead_capture')).toBe(true);
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_revenue')).toBe(true);
  });

  it('composes through the platform engines via the registry (no domain generic logic)', async () => {
    const provideSpy = jest.spyOn(marketingGrowthPlugin, 'provide').mockResolvedValue({
      modules: scoreMarketingGrowth(inputs as any).modules, recommendationInputs: scoreMarketingGrowth(inputs as any).recommendationInputs, score: 60, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(marketingGrowthPlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Marketing & Growth scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(snap.recommendations.some((r) => r.impact.cascade.length > 0)).toBe(true);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    provideSpy.mockRestore();
  });

  it('marketing_growth plugin is registered with report + dashboard support', () => {
    expect(marketingGrowthPlugin.supportedReports).toContain('growth');
    expect(marketingGrowthPlugin.supportedDashboards).toContain('marketing');
  });
});
