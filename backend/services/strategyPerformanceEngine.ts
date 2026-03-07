/**
 * Strategy Performance Engine
 * Phase 6: Evaluates performance of strategies from recommendations, outcomes, and feedback.
 */

import { supabase } from '../db/supabaseClient';

export type StrategyPerformanceResult = {
  strategy_performance_score: number;
  success_rate: number;
  impact_score: number;
  total_recommendations: number;
  total_outcomes: number;
  total_feedback: number;
};

/**
 * Evaluate strategy performance for a company from recommendations, outcomes, and feedback.
 */
export async function evaluateStrategyPerformance(
  companyId: string,
  options?: { windowDays?: number }
): Promise<StrategyPerformanceResult> {
  const windowDays = Math.min(90, Math.max(1, options?.windowDays ?? 30));
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceStr = since.toISOString();

  const [recResult, outcomeResult, feedbackResult] = await Promise.all([
    supabase
      .from('intelligence_recommendations')
      .select('id, confidence_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceStr),
    supabase
      .from('intelligence_outcomes')
      .select('success_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceStr),
    supabase
      .from('recommendation_feedback')
      .select('feedback_type, feedback_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceStr),
  ]);

  const recs = (recResult.data ?? []) as Array<{ confidence_score: number | null }>;
  const outcomes = (outcomeResult.data ?? []) as Array<{ success_score: number | null }>;
  const feedback = (feedbackResult.data ?? []) as Array<{ feedback_type: string; feedback_score: number | null }>;

  const totalRecommendations = recs.length;
  const totalOutcomes = outcomes.length;
  const totalFeedback = feedback.length;

  const successRate =
    totalOutcomes > 0
      ? outcomes.reduce((s, o) => s + (o.success_score ?? 0), 0) / totalOutcomes
      : totalFeedback > 0
        ? feedback.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / totalFeedback
        : 0.5;

  const avgRecConfidence =
    totalRecommendations > 0
      ? recs.reduce((s, r) => s + (r.confidence_score ?? 0.5), 0) / totalRecommendations
      : 0.5;

  const impactScore = Math.min(
    1,
    successRate * 0.5 + (totalOutcomes > 0 || totalFeedback > 0 ? 0.3 : 0) + avgRecConfidence * 0.2
  );

  const strategyPerformanceScore = Math.max(
    0,
    Math.min(1, successRate * 0.4 + impactScore * 0.4 + (totalRecommendations > 0 ? 0.2 : 0))
  );

  return {
    strategy_performance_score: Math.round(strategyPerformanceScore * 1000) / 1000,
    success_rate: Math.round(successRate * 1000) / 1000,
    impact_score: Math.round(impactScore * 1000) / 1000,
    total_recommendations: totalRecommendations,
    total_outcomes: totalOutcomes,
    total_feedback: totalFeedback,
  };
}
