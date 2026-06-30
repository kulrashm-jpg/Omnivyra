/**
 * Phase 30 — Unified Business Intelligence (cross-domain orchestration). Pure aggregation
 * over composed plugin snapshots: correlations, business health, risk, opportunity,
 * execution sequence, maturity, optimizer. Registry-only; no domain repositories.
 */
import { buildUnifiedBusinessIntelligence } from '../../services/crossDomain/crossDomainCorrelationEngine';
import { unifiedBusinessIntelligencePlugin } from '../../services/crossDomain/unifiedBusinessIntelligencePlugin';
import { composePluginSnapshot, toPresentationModel } from '../../services/platformIntelligence/registry';

const snap = (id: string, domain: string, score: number, recs: any[] = []): any => ({
  id, domain, displayName: domain, health: { overall: score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'disconnected', score },
  recommendations: recs, confidence: 0.7, businessImpact: { dimensions: {}, topDimensions: [], summary: '' }, executiveSummary: {}, roadmap: [], freshness: { lastEvaluatedAt: null, stale: true }, modules: [],
});
const rec = (recommendation: string, category: string, priority: number, roi = 'high'): any => ({ recommendation, category, priority, originEngine: 'x', businessImpact: 'high', estimatedEffort: 'low', estimatedROI: roi, impact: { summary: 'why' }, reason: 'why' });

const NOW_ISO = '2026-06-10T00:00:00Z';
const snapshots = [
  snap('website', 'website', 80, [rec('Add pricing page', 'high', 70)]),
  snap('marketing_growth', 'marketing_growth', 65, [rec('Connect analytics', 'quick_win', 80)]),
  snap('commercial_intelligence', 'commercial', 35, [rec('Instrument revenue', 'critical', 90, 'medium')]),
  snap('revenue_operations', 'revenue_operations', 40, [rec('Fix leakage', 'high', 85)]),
  snap('customer_intelligence', 'customer', 55, []),
  snap('growth', 'growth', 50, []),
  snap('readiness', 'readiness', 70, []),
];

describe('Phase 30 — Unified Business Intelligence', () => {
  it('correlates domains and derives influence sign from evidence', () => {
    const u = buildUnifiedBusinessIntelligence(snapshots, NOW_ISO);
    const websiteToLead = u.correlations.find((e) => e.from === 'website' && e.to === 'marketing_growth');
    expect(websiteToLead?.influence).toBe('supporting'); // website 80 ≥ 60
    const commercialEdge = u.correlations.find((e) => e.from === 'commercial' && e.to === 'revenue_operations');
    expect(commercialEdge?.influence).toBe('blocking'); // commercial 35 < 45
  });

  it('builds explained business health, risks, opportunities, execution, maturity, optimizer', () => {
    const u = buildUnifiedBusinessIntelligence(snapshots, NOW_ISO);
    expect(u.health.business.score).toBe(Math.round((80 + 65 + 35 + 40 + 55 + 50 + 70) / 7));
    expect(u.health.digital.score).toBe(80); // website
    expect(u.health.business.explanation).toContain('domains');
    expect(u.risks.find((r) => r.id === 'revenue')!.rootCause).toBeDefined();
    expect(u.opportunities.length).toBeGreaterThan(0);
    expect(u.execution.sequence.length).toBe(7);
    expect(u.optimizer.weakest).toBe('commercial'); // lowest score 35
    expect(u.optimizer.strongest).toBe('website');
    expect(u.maturity.overall).toBeGreaterThanOrEqual(1);
  });

  it('plugin composes through the platform engines (registry-only) and emits strategic recs', async () => {
    const spy = jest.spyOn(unifiedBusinessIntelligencePlugin, 'provide').mockResolvedValue({
      modules: [{ key: 'business_health', label: 'Overall Business Health', source: 'x', score: 56, status: 'partial', available: true, findings: ['x'], lastUpdated: NOW_ISO }],
      recommendationInputs: [{ key: 'optimize_weakest_domain', text: 'Optimise commercial.', source: 'unifiedBusinessIntelligence', module: 'business_health', impactLevel: 'high', confidence: 0.85 }],
      score: 56, lastUpdated: NOW_ISO,
    });
    const s = await composePluginSnapshot(unifiedBusinessIntelligencePlugin, 'co1', Date.parse(NOW_ISO));
    expect(s.executiveSummary.headline.startsWith('Business scores')).toBe(true);
    expect(s.recommendations[0]!.impact.cascade.length).toBeGreaterThan(0);
    expect(toPresentationModel(s).modules.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
