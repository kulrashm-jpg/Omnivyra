/**
 * Phase 34 — Product & Usage Intelligence (Plugin #11). Deterministic scorer (evidence-backed;
 * Unknown stays Unknown) + platform composition + report auto-discovery.
 */
import { scoreProductUsage } from '../../services/productUsage/productUsageEngine';
import { productUsagePlugin } from '../../services/productUsage/productUsagePlugin';
import { composePluginSnapshot, toPresentationModel, getPluginsForReport } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const inputs = {
  readiness: { generatedAt: '2026-06-01T00:00:00Z', checks: [{ id: 'cms', done: true }, { id: 'analytics', done: true }, { id: 'leads', done: false }] },
  growth: { contentVelocity: { publishedPosts: 12 }, publishing: { successRate: 0.9 }, community: { executedActions: 20 }, opportunities: { campaignsFromOpportunities: 3 } },
  leadStats: { total: 15, intentBands: { high: 2, medium: 5, low: 8 } },
};

describe('Phase 34 — Product & Usage scorer', () => {
  it('scores real adoption/usage evidence and keeps per-user signals Unknown', () => {
    const r = scoreProductUsage(inputs as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('activation').score).toBe(67); // 2/3 done
    expect(m('content_creation').available).toBe(true);
    expect(m('feature_adoption').available).toBe(true);
    expect(m('stickiness').available).toBe(false); // Unknown — no DAU/MAU
    expect(m('utilization').available).toBe(false); // Unknown — no seats
    expect(m('user_engagement').available).toBe(false); // Unknown — no per-user data
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_user_engagement')).toBe(true);
    expect(r.recommendationInputs.some((i) => i.key === 'complete_activation')).toBe(true);
  });

  it('is mostly Unknown with no usage evidence', () => {
    const r = scoreProductUsage({ readiness: null, growth: null, leadStats: null } as any);
    expect(r.modules.find((x) => x.key === 'activation')!.available).toBe(false);
    expect(r.modules.find((x) => x.key === 'product_health')!.available).toBe(false);
  });

  it('composes through the platform engines and is report-discoverable + decision/unified-consumed', async () => {
    const spy = jest.spyOn(productUsagePlugin, 'provide').mockResolvedValue({
      modules: scoreProductUsage(inputs as any).modules, recommendationInputs: scoreProductUsage(inputs as any).recommendationInputs, score: 60, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(productUsagePlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Product & usage scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
    // registered → auto-discovered by reports (and by decision/unified which compose the registry)
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'product_usage')).toBe(true);
  });
});
