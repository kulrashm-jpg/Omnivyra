/**
 * Phase 35 — Partner & Channel Intelligence (Plugin #12). Deterministic scorer (evidence-backed;
 * Unknown stays Unknown) + platform composition + report auto-discovery.
 */
import { scoreChannelIntelligence } from '../../services/partnerChannel/partnerChannelEngine';
import { partnerChannelPlugin } from '../../services/partnerChannel/partnerChannelPlugin';
import { composePluginSnapshot, toPresentationModel, getPluginsForReport } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const inputs = {
  attribution: { generatedAt: '2026-06-01T00:00:00Z', totals: { leads: 20, leadsWithAttribution: 16 }, channelBreakdown: { organic_search: 9, social: 4, email: 5, direct: 2 }, campaignBreakdown: { spring: 6, fall: 3 } },
  leadStats: { total: 20, intentBands: { high: 4, medium: 6, low: 10 } },
  cohort: { totalRevenueUsd: 8000, cohorts: [] },
  journey: { bottleneck: 'lead→opportunity' },
};

describe('Phase 35 — Partner & Channel scorer', () => {
  it('scores per-channel + attribution evidence; keeps per-channel revenue/partner Unknown', () => {
    const r = scoreChannelIntelligence(inputs as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('organic_health').available).toBe(true);
    expect(m('paid_health').score).toBe(0); // no paid leads observed (evidence: 0 of 20)
    expect(m('attribution_confidence').score).toBe(80); // 16/20
    expect(m('channel_diversity').score).toBe(100); // 4 active channels
    expect(m('revenue_contribution').available).toBe(false); // Unknown — no per-channel revenue
    expect(m('partner_health').available).toBe(false); // Unknown — no partner channel
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_channel_revenue')).toBe(true);
  });

  it('is Unknown with no attribution evidence', () => {
    const r = scoreChannelIntelligence({ attribution: null, leadStats: null, cohort: null, journey: null } as any);
    expect(r.modules.find((x) => x.key === 'organic_health')!.available).toBe(false);
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_attribution')).toBe(true);
  });

  it('composes through the platform engines and is report-discoverable (decision/unified auto-consume)', async () => {
    const spy = jest.spyOn(partnerChannelPlugin, 'provide').mockResolvedValue({
      modules: scoreChannelIntelligence(inputs as any).modules, recommendationInputs: scoreChannelIntelligence(inputs as any).recommendationInputs, score: 55, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(partnerChannelPlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Partner & channel scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'partner_channel')).toBe(true);
  });
});
