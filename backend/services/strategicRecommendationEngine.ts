/**
 * Strategic Recommendation Engine
 * Phase 3: Converts opportunities into actionable recommendations.
 * Types: content_opportunity, product_opportunity, marketing_opportunity, competitive_opportunity
 */

import type { Opportunity, OpportunityType } from './opportunityDetectionEngine';

export type RecommendationType =
  | 'content_opportunity'
  | 'product_opportunity'
  | 'marketing_opportunity'
  | 'competitive_opportunity';

export type StrategicRecommendation = {
  recommendation_type: RecommendationType;
  confidence_score: number;
  action_summary: string;
  supporting_signals: Array<{ signal_id: string; topic: string | null }>;
};

const OPPORTUNITY_TO_RECOMMENDATION: Record<OpportunityType, RecommendationType> = {
  emerging_trend: 'content_opportunity',
  competitor_weakness: 'competitive_opportunity',
  market_gap: 'product_opportunity',
  customer_pain_signal: 'marketing_opportunity',
};

/**
 * Convert opportunities into strategic recommendations.
 */
export function opportunitiesToRecommendations(
  opportunities: Opportunity[]
): StrategicRecommendation[] {
  const recommendations: StrategicRecommendation[] = [];

  for (const opp of opportunities) {
    const recType = OPPORTUNITY_TO_RECOMMENDATION[opp.opportunity_type];
    const confidence = Math.min(1, opp.opportunity_score * 0.9 + 0.1);

    let actionSummary: string;
    switch (recType) {
      case 'content_opportunity':
        actionSummary = `Create content addressing emerging trend: ${opp.summary.replace(/^Emerging trend: /, '')}`;
        break;
      case 'product_opportunity':
        actionSummary = `Evaluate product/feature opportunity for market gap: ${opp.summary.replace(/^Market shift\/gap: |^Market shift linkage.*/, '')}`;
        break;
      case 'marketing_opportunity':
        actionSummary = `Develop marketing angle for customer pain: ${opp.summary.replace(/^Customer pain: /, '')}`;
        break;
      case 'competitive_opportunity':
        actionSummary = `Leverage competitor weakness in positioning: ${opp.summary.replace(/^Competitor weakness signal: /, '')}`;
        break;
      default:
        actionSummary = opp.summary;
    }

    recommendations.push({
      recommendation_type: recType,
      confidence_score: confidence,
      action_summary: actionSummary,
      supporting_signals: opp.supporting_signals.map((s) => ({
        signal_id: s.signal_id,
        topic: s.topic ?? null,
      })),
    });
  }

  return recommendations
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 15);
}
