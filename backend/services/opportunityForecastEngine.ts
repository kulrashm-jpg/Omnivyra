/**
 * Opportunity Forecast Engine
 * Evaluates opportunity strength and recommends actions (monitor, content_response, campaign_recommended).
 * Used by engagement opportunity scanner to auto-generate campaign proposals for high-confidence opportunities.
 */

export type OpportunityForecastInput = {
  signal_count: number;
  confidence_score: number;
  engagement_score_avg: number;
  recency_factor: number;
};

export type RecommendedAction = 'monitor' | 'content_response' | 'campaign_recommended';

export type OpportunityForecastResult = {
  opportunity_strength: number;
  recommended_action: RecommendedAction;
};

/** Thresholds for action recommendation */
const THRESHOLD_MONITOR = 40;
const THRESHOLD_CONTENT_RESPONSE = 70;

/**
 * Evaluate opportunity strength using weighted scoring formula.
 * Weights: signal_count 35%, confidence_score 35%, engagement_score_avg 20%, recency_factor 10%.
 * Output scaled to 0–100.
 */
export function evaluateOpportunityStrength(input: OpportunityForecastInput): OpportunityForecastResult {
  const {
    signal_count,
    confidence_score,
    engagement_score_avg,
    recency_factor,
  } = input;

  // Normalize components to 0–100 scale:
  // signal_count: cap at 100, contribute up to 35 pts
  const signalContribution = Math.min(100, Math.max(0, signal_count)) / 100 * 35;
  // confidence_score: 0–1 scale, contribute up to 35 pts
  const confidenceContribution = Math.min(1, Math.max(0, confidence_score)) * 35;
  // engagement_score_avg: assume 0–10 scale, contribute up to 20 pts
  const engagementContribution = Math.min(1, Math.max(0, engagement_score_avg) / 10) * 20;
  // recency_factor: 0–1 scale, contribute up to 10 pts
  const recencyContribution = Math.min(1, Math.max(0, recency_factor)) * 10;

  const opportunity_strength = Math.round(
    Math.min(100, Math.max(0, signalContribution + confidenceContribution + engagementContribution + recencyContribution))
  );

  let recommended_action: RecommendedAction;
  if (opportunity_strength < THRESHOLD_MONITOR) {
    recommended_action = 'monitor';
  } else if (opportunity_strength < THRESHOLD_CONTENT_RESPONSE) {
    recommended_action = 'content_response';
  } else {
    recommended_action = 'campaign_recommended';
  }

  return {
    opportunity_strength,
    recommended_action,
  };
}
