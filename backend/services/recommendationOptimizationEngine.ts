/**
 * Recommendation Optimization Engine
 * Phase 6: Improves recommendation generation via thresholds and ranking.
 * Safeguards: confidence_range [0,1], ranking_score_range [0,1]
 */

import { supabase } from '../db/supabaseClient';

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;
export const RANKING_SCORE_MIN = 0;
export const RANKING_SCORE_MAX = 1;
export const MAX_THRESHOLD_CHANGE = 0.15;
export const OPTIMIZATION_FREQUENCY_MS = 6 * 60 * 60 * 1000;

export type RecommendationOptimizationResult = {
  confidence_threshold: number;
  opportunity_score_threshold: number;
  ranking_adjustment: number;
  recommendation_count: number;
  success_rate: number;
};

/**
 * Load last thresholds from metrics.
 */
async function loadLastThresholds(companyId: string): Promise<{
  confidence_threshold: number;
  opportunity_score_threshold: number;
  ranking_adjustment: number;
}> {
  const defaults = { confidence_threshold: 0.4, opportunity_score_threshold: 0.35, ranking_adjustment: 0 };
  const types = ['rec_confidence_threshold', 'rec_opportunity_threshold', 'rec_ranking_adjustment'];
  for (const t of types) {
    const key = t === 'rec_confidence_threshold' ? 'confidence_threshold' : t === 'rec_opportunity_threshold' ? 'opportunity_score_threshold' : 'ranking_adjustment';
    const { data } = await supabase
      .from('intelligence_optimization_metrics')
      .select('metric_value')
      .eq('company_id', companyId)
      .eq('metric_type', t)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.metric_value != null) (defaults as Record<string, number>)[key] = Number(data.metric_value);
  }
  return defaults;
}

/**
 * Compute optimized recommendation thresholds from outcomes and feedback.
 */
export async function computeRecommendationOptimization(
  companyId: string
): Promise<RecommendationOptimizationResult> {
  const [thresholds, outcomes, feedback, recs] = await Promise.all([
    loadLastThresholds(companyId),
    supabase
      .from('intelligence_outcomes')
      .select('success_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('recommendation_feedback')
      .select('feedback_type, feedback_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('intelligence_recommendations')
      .select('confidence_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const outcomeScores = (outcomes.data ?? []) as Array<{ success_score: number | null }>;
  const feedbackScores = (feedback.data ?? []) as Array<{ feedback_score: number | null }>;
  const recScores = (recs.data ?? []) as Array<{ confidence_score: number | null }>;

  const successRate =
    outcomeScores.length > 0
      ? outcomeScores.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeScores.length
      : feedbackScores.length > 0
        ? feedbackScores.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackScores.length
        : 0.5;

  const delta = (successRate - 0.5) * 0.3;
  const clamped = Math.max(-MAX_THRESHOLD_CHANGE, Math.min(MAX_THRESHOLD_CHANGE, delta));

  let confidenceThreshold = Math.max(
    CONFIDENCE_MIN,
    Math.min(CONFIDENCE_MAX, thresholds.confidence_threshold - clamped)
  );
  let opportunityScoreThreshold = Math.max(
    CONFIDENCE_MIN,
    Math.min(CONFIDENCE_MAX, thresholds.opportunity_score_threshold - clamped * 0.8)
  );
  let rankingAdjustment = Math.max(
    RANKING_SCORE_MIN - 0.5,
    Math.min(RANKING_SCORE_MAX - 0.5, thresholds.ranking_adjustment + clamped * 0.5)
  );

  return {
    confidence_threshold: Math.round(confidenceThreshold * 1000) / 1000,
    opportunity_score_threshold: Math.round(opportunityScoreThreshold * 1000) / 1000,
    ranking_adjustment: Math.round(rankingAdjustment * 1000) / 1000,
    recommendation_count: recScores.length,
    success_rate: Math.round(successRate * 1000) / 1000,
  };
}
