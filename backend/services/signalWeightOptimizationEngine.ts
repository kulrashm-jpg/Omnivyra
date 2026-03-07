/**
 * Signal Weight Optimization Engine
 * Phase 6: Adjusts weights for signal relevance, opportunity detection, correlation scoring.
 * Safeguard: max_weight_change = ±0.15
 */

import { supabase } from '../db/supabaseClient';

export const MAX_WEIGHT_CHANGE = 0.15;
export const OPTIMIZATION_FREQUENCY_MS = 6 * 60 * 60 * 1000;

export type SignalWeightResult = {
  updated_signal_weights: {
    signal_relevance_weight: number;
    opportunity_detection_weight: number;
    correlation_scoring_weight: number;
  };
  weight_confidence: number;
  adjustments_applied: Record<string, number>;
};

const DEFAULT_WEIGHTS = {
  signal_relevance_weight: 1.0,
  opportunity_detection_weight: 1.0,
  correlation_scoring_weight: 1.0,
};

/**
 * Load last known weights from metrics for a company.
 */
async function loadLastWeights(companyId: string): Promise<Record<string, number>> {
  const types = ['signal_relevance_weight', 'opportunity_detection_weight', 'correlation_scoring_weight'];
  const weights: Record<string, number> = { ...DEFAULT_WEIGHTS };
  for (const t of types) {
    const { data } = await supabase
      .from('intelligence_optimization_metrics')
      .select('metric_value')
      .eq('company_id', companyId)
      .eq('metric_type', t)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.metric_value != null) weights[t] = Number(data.metric_value);
  }
  return weights;
}

/**
 * Compute optimized weights from outcomes and feedback; apply stability guard.
 */
export async function computeOptimizedWeights(
  companyId: string
): Promise<SignalWeightResult> {
  const [weights, outcomes, feedback] = await Promise.all([
    loadLastWeights(companyId),
    supabase
      .from('intelligence_outcomes')
      .select('success_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('recommendation_feedback')
      .select('feedback_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const outcomeScores = (outcomes.data ?? []) as Array<{ success_score: number | null }>;
  const feedbackScores = (feedback.data ?? []) as Array<{ feedback_score: number | null }>;

  const avgSuccess =
    outcomeScores.length > 0
      ? outcomeScores.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeScores.length
      : feedbackScores.length > 0
        ? feedbackScores.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackScores.length
        : 0.5;

  const delta = (avgSuccess - 0.5) * 0.4;
  const clampedDelta = Math.max(-MAX_WEIGHT_CHANGE, Math.min(MAX_WEIGHT_CHANGE, delta));

  const adjustments: Record<string, number> = {
    signal_relevance_weight: Math.max(-MAX_WEIGHT_CHANGE, Math.min(MAX_WEIGHT_CHANGE, clampedDelta * 0.5)),
    opportunity_detection_weight: Math.max(-MAX_WEIGHT_CHANGE, Math.min(MAX_WEIGHT_CHANGE, clampedDelta * 0.7)),
    correlation_scoring_weight: Math.max(-MAX_WEIGHT_CHANGE, Math.min(MAX_WEIGHT_CHANGE, clampedDelta * 0.4)),
  };

  const updated_signal_weights = {
    signal_relevance_weight: Math.max(0, Math.min(2, weights.signal_relevance_weight + adjustments.signal_relevance_weight)),
    opportunity_detection_weight: Math.max(0, Math.min(2, weights.opportunity_detection_weight + adjustments.opportunity_detection_weight)),
    correlation_scoring_weight: Math.max(0, Math.min(2, weights.correlation_scoring_weight + adjustments.correlation_scoring_weight)),
  };

  const weightConfidence = Math.max(0, Math.min(1, 0.5 + clampedDelta * 2));

  return {
    updated_signal_weights,
    weight_confidence: Math.round(weightConfidence * 1000) / 1000,
    adjustments_applied: adjustments,
  };
}

/**
 * Persist optimized weights to metrics (one row per type per day via upsert).
 */
export async function persistOptimizedWeights(
  companyId: string,
  weights: SignalWeightResult['updated_signal_weights']
): Promise<void> {
  for (const [metricType, value] of Object.entries(weights)) {
    await supabase.from('intelligence_optimization_metrics').upsert(
      {
        company_id: companyId,
        metric_type: metricType,
        metric_value: value,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,metric_type,metric_date', ignoreDuplicates: false }
    );
  }
}
