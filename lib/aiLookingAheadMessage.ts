/**
 * AI Looking Ahead Preview — presentation-only helper.
 * Returns a calm, proactive message from existing week signals.
 * No logic changes; narrative framing only.
 */

export type WeekLike = {
  week_extras?: { recovered_topics?: unknown[] } | null;
  momentum_adjustments?: { absorbed_from_week?: unknown } | null;
  planning_adjustments_summary?: unknown;
  distribution_strategy?: string | null;
};

/**
 * Returns a single AI preview message for the week, or null.
 * Priority: Narrative Recovery > Momentum > Workload Balancing > Distribution (STAGGERED).
 */
export function getAiLookingAheadMessage(week: WeekLike | null | undefined): string | null {
  if (!week || typeof week !== 'object') return null;

  // Rule A — Narrative Recovery (highest priority)
  if (Array.isArray(week.week_extras?.recovered_topics) && week.week_extras.recovered_topics.length > 0) {
    return 'AI is carrying forward strategic context to keep your campaign narrative aligned.';
  }

  // Rule B — Momentum Adjustment
  if (week.momentum_adjustments?.absorbed_from_week != null) {
    return 'AI adjusted momentum to keep your strategy progressing smoothly.';
  }

  // Rule C — Workload Balancing
  if (week.planning_adjustments_summary != null && week.planning_adjustments_summary !== '') {
    return 'AI balanced workload while preserving key strategic priorities.';
  }

  // Rule D — Distribution Intelligence
  if (String(week.distribution_strategy ?? '').toUpperCase() === 'STAGGERED') {
    return 'AI is spacing content to maximize cross-platform impact.';
  }

  return null;
}
