/**
 * Phase 24 — Decision Intelligence (strategic brain). Tests the pure cross-plugin
 * aggregation (consumes composed plugin snapshots only) + plugin registration. It owns no
 * generic intelligence; it aggregates/prioritises/explains across domains.
 */
import { aggregateDecision } from '../../services/decisionIntelligence/decisionIntelligenceEngine';
import { decisionIntelligencePlugin } from '../../services/decisionIntelligence/decisionIntelligencePlugin';

const snap = (id: string, domain: string, displayName: string, score: number, recs: any[]): any => ({
  id, domain, displayName, health: { overall: score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'disconnected', score },
  recommendations: recs, confidence: 0.7, businessImpact: { dimensions: {}, topDimensions: [], summary: '' },
  executiveSummary: {}, roadmap: [], freshness: { lastEvaluatedAt: null, stale: true }, modules: [],
});
const rec = (recommendation: string, category: string, priority: number): any => ({
  recommendation, category, priority, originEngine: 'x', businessImpact: 'high', estimatedEffort: 'low', estimatedROI: 'high', impact: { summary: 'why' }, reason: 'why',
});

describe('Phase 24 — Decision Intelligence aggregation', () => {
  const snapshots = [
    snap('website', 'website', 'Website', 80, [rec('Add pricing page', 'high', 70)]),
    snap('marketing_growth', 'marketing_growth', 'Marketing & Growth', 70, [rec('Connect analytics', 'quick_win', 80), rec('Increase content', 'medium', 50)]),
    snap('commercial_intelligence', 'commercial', 'Commercial', 40, [rec('Instrument revenue', 'critical', 90)]),
    snap('readiness', 'readiness', 'Readiness', 30, [rec('Configure lead capture', 'high', 85)]),
  ];

  it('aggregates cross-domain health, scores, priorities, dependency graph and roadmap', () => {
    const d = aggregateDecision(snapshots, '2026-06-10T00:00:00Z');
    expect(d.health.business.score).toBe(Math.round((80 + 70 + 40 + 30) / 4)); // 55
    expect(d.health.digital.score).toBe(80); // ONLY from the website plugin via registry
    expect(d.health.marketing.score).toBe(70);
    expect(d.health.sales.score).toBe(40); // commercial
    expect(d.scores.executiveDecision).toBe(55);
    // global priority re-rank (highest first, across all plugins)
    expect(d.priorities[0]!.priority).toBe(90);
    expect(d.priorities.every((p, i, a) => i === 0 || a[i - 1]!.priority >= p.priority)).toBe(true);
    // dependency graph: commercial depends on marketing_growth (both present)
    expect(d.dependencyGraph.find((n) => n.node === 'commercial')?.dependsOn).toContain('marketing_growth');
    // 6-horizon roadmap; critical → immediate
    expect(d.roadmap.map((r) => r.horizon)).toEqual(['immediate', '30_day', '60_day', '90_day', '6_month', '12_month']);
    expect(d.roadmap[0]!.items.some((i) => i.includes('Instrument revenue'))).toBe(true);
    expect(d.maturity.overall).toBeGreaterThanOrEqual(1);
    expect(d.opportunities.length).toBeGreaterThan(0);
  });

  it('keeps a domain Unknown when it is not registered/composed', () => {
    const d = aggregateDecision([snapshots[0]!], '2026-06-10T00:00:00Z');
    expect(d.health.revenue.score).toBeNull(); // no commercial plugin → Unknown
    expect(d.health.revenue.status).toBe('disconnected');
  });

  it('is registered as a platform plugin consuming the registry', () => {
    expect(decisionIntelligencePlugin.id).toBe('decision_intelligence');
    expect(decisionIntelligencePlugin.supportedReports).toContain('snapshot');
  });
});
