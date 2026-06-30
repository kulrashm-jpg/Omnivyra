/**
 * Phase 28 — Customer Intelligence (post-conversion) on the Platform Intelligence Framework.
 * Deterministic scorer (evidence-backed; Unknown stays Unknown) + plugin composition.
 */
import { scoreCustomerIntelligence } from '../../services/customerIntelligence/customerIntelligenceEngine';
import { customerIntelligencePlugin } from '../../services/customerIntelligence/customerIntelligencePlugin';
import { composePluginSnapshot, toPresentationModel, getPluginsForReport } from '../../services/platformIntelligence/registry';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const evidenced = {
  cohort: { generatedAt: '2026-06-01T00:00:00Z', totalRevenueUsd: 9000, cohorts: [{ stages: [{ stage: 'closed_won', count: 5 }] }] },
  community: { total: 20, positive: 12, negative: 3, neutral: 5 },
  lastUpdated: '2026-06-01T00:00:00Z',
};

describe('Phase 28 — Customer Intelligence scorer', () => {
  it('scores evidenced customer signals and keeps the rest Unknown', () => {
    const r = scoreCustomerIntelligence(evidenced as any);
    const m = (k: string) => r.modules.find((x) => x.key === k)!;
    expect(m('customer_base').available).toBe(true); // 5 closed-won
    expect(m('customer_revenue').available).toBe(true); // revenue lineage
    expect(m('advocacy').score).toBe(60); // 12/20 positive
    expect(m('retention_health').available).toBe(false); // Unknown — no churn data
    expect(m('lifetime_value').available).toBe(false); // Unknown
    expect(m('product_adoption').available).toBe(false); // Unknown
    expect(r.recommendationInputs.some((i) => i.key === 'instrument_retention')).toBe(true);
  });

  it('is mostly Unknown with no customer evidence', () => {
    const r = scoreCustomerIntelligence({ cohort: null, community: null, lastUpdated: null } as any);
    expect(r.modules.find((x) => x.key === 'customer_base')!.available).toBe(false);
    expect(r.recommendationInputs.some((i) => i.key === 'build_customer_base')).toBe(true);
  });

  it('composes through the platform engines and is report-discoverable', async () => {
    const spy = jest.spyOn(customerIntelligencePlugin, 'provide').mockResolvedValue({
      modules: scoreCustomerIntelligence(evidenced as any).modules, recommendationInputs: scoreCustomerIntelligence(evidenced as any).recommendationInputs, score: 55, lastUpdated: '2026-06-01T00:00:00Z',
    });
    const snap = await composePluginSnapshot(customerIntelligencePlugin, 'co1', NOW);
    expect(snap.executiveSummary.headline.startsWith('Customer base scores')).toBe(true);
    expect(snap.roadmap.map((h) => h.horizon)).toEqual(['30_day', '60_day', '90_day']);
    expect(toPresentationModel(snap).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
    // registered + auto-discovered (no report edits needed)
    expect(getPluginsForReport('snapshot').some((p) => p.id === 'customer_intelligence')).toBe(true);
  });
});
