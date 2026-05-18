/**
 * weeklyGenerationFallback — Phase-2 Step-11 rollback safety.
 * Decides whether the authoritative weekly plan is safe to be the actual
 * output, or generation must roll back to the legacy generator.
 */

import type { GenerationExecutionContext } from '../generationExecutionContextTypes';
import type { AuthoritativeWeeklyPlan } from './weeklyGenerationMapper';

export interface WeeklyFallbackDecision {
  should_fallback: boolean;
  reason: string | null;
}

/**
 * Rollback conditions: empty/uncovered output, EMPTY generation mode,
 * routing conflict (all routes unclassified), or missing execution
 * coverage vs the legacy row count (regression guard).
 */
export function evaluateWeeklyFallback(
  ctx: GenerationExecutionContext | null,
  plan: AuthoritativeWeeklyPlan | null,
  legacyRowCount: number,
): WeeklyFallbackDecision {
  if (!ctx) return { should_fallback: true, reason: 'authoritative_context_unavailable' };
  if (ctx.generation_mode === 'EMPTY') return { should_fallback: true, reason: 'empty_generation_mode' };
  if (!plan || plan.rows.length === 0) return { should_fallback: true, reason: 'no_authoritative_rows' };

  const allUnknownRouting =
    Object.keys(plan.routing_distribution).length > 0 &&
    Object.keys(plan.routing_distribution).every((k) => k === 'MANUAL' || k === 'unknown');
  if (allUnknownRouting) return { should_fallback: true, reason: 'routing_conflict_all_unclassified' };

  // Coverage regression: authoritative produced materially fewer rows than
  // legacy would have (lose >25% of execution coverage) → roll back.
  if (legacyRowCount > 0 && plan.rows.length < Math.floor(legacyRowCount * 0.75)) {
    return { should_fallback: true, reason: `coverage_regression(${plan.rows.length}<${legacyRowCount})` };
  }
  return { should_fallback: false, reason: null };
}
