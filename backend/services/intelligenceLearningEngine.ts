/**
 * Intelligence Learning Engine
 * Phase 5: Adjusts scoring from historical outcomes and feedback.
 * Safeguards: adjustment_range [-0.25, +0.25], scores bounded [0, 1]
 * Batch processing: batch_size=100, max every 15 minutes
 */

import { supabase } from '../db/supabaseClient';
import type { OutcomeRow } from './outcomeTrackingEngine';

export const ADJUSTMENT_MIN = -0.25;
export const ADJUSTMENT_MAX = 0.25;
export const BATCH_SIZE = 100;
export const MAX_LEARNING_FREQUENCY_MS = 15 * 60 * 1000;

export type LearningAdjustment = {
  learning_adjustment_score: number;
  updated_confidence: number;
  signal_relevance_adjustment: number;
  opportunity_score_adjustment: number;
  recommendation_confidence_adjustment: number;
  theme_strength_adjustment: number;
};

/**
 * Compute learning adjustments from batched outcomes and feedback.
 * Must be called with batches (e.g. latest 100 outcomes).
 */
export function computeLearningAdjustments(
  outcomes: OutcomeRow[],
  feedbackRows: Array<{ feedback_type: string; feedback_score: number | null }>
): LearningAdjustment {
  const outcomesBatch = outcomes.slice(0, BATCH_SIZE);
  const feedbackBatch = feedbackRows.slice(0, BATCH_SIZE);

  const avgOutcomeSuccess =
    outcomesBatch.length > 0
      ? outcomesBatch.reduce((s, o) => s + (o.success_score ?? 0), 0) / outcomesBatch.length
      : 0.5;

  const avgFeedback =
    feedbackBatch.length > 0
      ? feedbackBatch.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackBatch.length
      : 0.5;

  const rawAdjustment = (avgOutcomeSuccess - 0.5) * 0.3 + (avgFeedback - 0.5) * 0.2;
  const clamped = Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, rawAdjustment));

  const baseConfidence = 0.5 + clamped;
  const updatedConfidence = Math.max(0, Math.min(1, baseConfidence));

  return {
    learning_adjustment_score: clamped,
    updated_confidence: updatedConfidence,
    signal_relevance_adjustment: Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, clamped * 0.5)),
    opportunity_score_adjustment: Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, clamped * 0.6)),
    recommendation_confidence_adjustment: Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, clamped * 0.8)),
    theme_strength_adjustment: Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, clamped * 0.4)),
  };
}

/**
 * Fetch batched outcomes and feedback, compute adjustments.
 */
export async function computeLearningForCompany(
  companyId: string
): Promise<LearningAdjustment> {
  const { data: outcomes } = await supabase
    .from('intelligence_outcomes')
    .select('id, company_id, recommendation_id, outcome_type, success_score, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE);

  const { data: feedback } = await supabase
    .from('recommendation_feedback')
    .select('feedback_type, feedback_score')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE);

  return computeLearningAdjustments(
    (outcomes ?? []) as OutcomeRow[],
    (feedback ?? []) as Array<{ feedback_type: string; feedback_score: number | null }>
  );
}

/**
 * Apply adjustment to a score, keeping in [0, 1].
 */
export function applyAdjustment(score: number, adjustment: number): number {
  return Math.max(0, Math.min(1, score + adjustment));
}
