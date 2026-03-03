/**
 * AI Strategic Confidence Whisper — presentation-only helper.
 * Returns a short confidence narrative from existing week signals.
 * No scoring, no new logic; narrative framing only.
 */

export type WeekLike = {
  planning_adjustments_summary?: unknown;
  momentum_adjustments?: {
    momentum_transfer_strength?: string;
    narrative_recovery?: boolean;
    [key: string]: unknown;
  } | null;
  distribution_strategy?: string | null;
};

/**
 * Returns a single AI confidence message for the week, or null.
 * Priority: A (adapting) → B (stable momentum) → C (STAGGERED, no adjustments) → D (default calm) → E (no data).
 */
export function getAiStrategicConfidence(week: WeekLike | null | undefined): string | null {
  if (!week || typeof week !== 'object') return null;

  const hasPlanningSummary = week.planning_adjustments_summary != null && week.planning_adjustments_summary !== '';
  const narrativeRecovery = week.momentum_adjustments?.narrative_recovery === true;
  const hasMomentum = week.momentum_adjustments != null;
  const isLightMomentum =
    String(week.momentum_adjustments?.momentum_transfer_strength ?? '').toLowerCase() === 'light';
  const isStaggered = String(week.distribution_strategy ?? '').toUpperCase() === 'STAGGERED';

  // Rule A — Strategy Adapting (highest priority)
  if (hasPlanningSummary || narrativeRecovery) {
    return 'AI Confidence: Strategy is adapting while preserving momentum.';
  }

  // Rule B — Stable Momentum
  if (hasMomentum && isLightMomentum) {
    return 'AI Confidence: Strategy momentum is stable.';
  }

  // Rule C — Expansion Confidence (STAGGERED, no adjustments)
  if (isStaggered && !hasPlanningSummary && !narrativeRecovery) {
    return 'AI Confidence: Strategy execution is progressing steadily across channels.';
  }

  // Rule D — Default Calm State
  return 'AI Confidence: Strategy direction looks consistent.';
}
