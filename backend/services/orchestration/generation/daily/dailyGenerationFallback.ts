/**
 * dailyGenerationFallback — Phase-2 Step-13 rollback safety.
 */

import type { GenerationExecutionContext } from '../generationExecutionContextTypes';
import type { AuthoritativeDailyPlan } from './dailyGenerationMapper';

export interface DailyFallbackDecision {
  should_fallback: boolean;
  reason: string | null;
}

export function evaluateDailyFallback(
  ctx: GenerationExecutionContext | null,
  plan: AuthoritativeDailyPlan | null,
  legacyCount: number,
): DailyFallbackDecision {
  if (!ctx) return { should_fallback: true, reason: 'authoritative_context_unavailable' };
  if (ctx.generation_mode === 'EMPTY') return { should_fallback: true, reason: 'empty_generation_mode' };
  if (!plan || plan.cards.length === 0) return { should_fallback: true, reason: 'no_authoritative_cards' };

  const allUnknownRouting =
    Object.keys(plan.routing_distribution).length > 0 &&
    Object.keys(plan.routing_distribution).every((k) => k === 'MANUAL' || k === 'unknown');
  if (allUnknownRouting) return { should_fallback: true, reason: 'routing_regression_all_unclassified' };

  if (legacyCount > 0 && plan.cards.length < Math.floor(legacyCount * 0.75)) {
    return { should_fallback: true, reason: `coverage_regression(${plan.cards.length}<${legacyCount})` };
  }
  return { should_fallback: false, reason: null };
}
