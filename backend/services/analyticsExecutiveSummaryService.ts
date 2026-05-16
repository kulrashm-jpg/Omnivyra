import type { AnalyticsFreshnessSnapshot } from './analyticsFreshnessService';
import type { EnterpriseOpportunity, AnalyticsTrustGovernance } from './analyticsEnterpriseSnapshotService';

export type AnalyticsExecutiveSummary = {
  status: 'strong' | 'watch' | 'risk' | 'insufficient';
  headline: string;
  kpis: {
    trust_score: number;
    completeness_score: number;
    total_opportunities: number;
    high_priority_opportunities: number;
  };
  priority_actions: Array<{
    rank: number;
    title: string;
    severity: 'high' | 'medium' | 'low';
    confidence: EnterpriseOpportunity['confidence'];
    evidence: Record<string, unknown>;
  }>;
  risks: string[];
  trust_indicators: string[];
};

function severityFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function buildAnalyticsExecutiveSummary(input: {
  governance: AnalyticsTrustGovernance;
  freshness: { ga: AnalyticsFreshnessSnapshot; gsc: AnalyticsFreshnessSnapshot };
  opportunities: EnterpriseOpportunity[];
}): AnalyticsExecutiveSummary {
  const highPriority = input.opportunities.filter((item) => item.score >= 75);
  const risks: string[] = [];
  if (input.freshness.ga.classification === 'stale' || input.freshness.gsc.classification === 'stale') {
    risks.push('One or more analytics sources are stale; executive decisions should treat insights as directional.');
  }
  if (input.governance.completeness_score < 100) {
    risks.push('Analytics completeness is partial; some provider evidence is missing.');
  }
  if (input.opportunities.length === 0) {
    risks.push('No evidence-backed opportunity has crossed the prioritization threshold.');
  }

  const status: AnalyticsExecutiveSummary['status'] =
    input.governance.trust_score >= 80 && highPriority.length > 0 ? 'strong'
      : input.governance.trust_score >= 60 ? 'watch'
        : input.governance.trust_score > 0 ? 'risk'
          : 'insufficient';

  return {
    status,
    headline: status === 'strong'
      ? 'Analytics evidence is trustworthy enough for executive prioritization.'
      : status === 'watch'
        ? 'Analytics evidence is usable, with freshness or signal-strength caveats.'
        : status === 'risk'
          ? 'Analytics evidence is degraded and should be treated cautiously.'
          : 'Analytics evidence is insufficient for executive prioritization.',
    kpis: {
      trust_score: input.governance.trust_score,
      completeness_score: input.governance.completeness_score,
      total_opportunities: input.opportunities.length,
      high_priority_opportunities: highPriority.length,
    },
    priority_actions: input.opportunities
      .filter((item) => item.confidence !== 'low' || item.score >= 70)
      .slice(0, 5)
      .map((item, index) => ({
        rank: index + 1,
        title: item.title,
        severity: severityFor(item.score),
        confidence: item.confidence,
        evidence: item.evidence,
      })),
    risks,
    trust_indicators: [
      `GA freshness: ${input.freshness.ga.classification}`,
      `GSC freshness: ${input.freshness.gsc.classification}`,
      `Unsupported claim policy: ${input.governance.unsupported_claim_policy}`,
    ],
  };
}
