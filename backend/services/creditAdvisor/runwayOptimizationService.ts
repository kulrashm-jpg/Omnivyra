/**
 * Credit Advisor — Phase 17: Credit Runway Optimizer.
 *
 * Computes how many additional days of runway are available if the detected
 * optimization opportunities are applied. Deterministic; caps per-module savings
 * at that module's spend and total savings at current burn (can't save more than
 * is spent). READ-ONLY.
 */

import type { ModuleAggregates } from './optimizationAggregates';
import type {
  ConsumptionMetrics,
  OptimizationOpportunity,
  RunwayOptimization,
} from './creditAdvisorTypes';

const round1 = (n: number) => Math.round(n * 10) / 10;

function runwayDays(remaining: number, dailyBurn: number): number | null {
  return dailyBurn > 0.0001 ? round1(remaining / dailyBurn) : null;
}

export function optimizeRunway(
  metrics: ConsumptionMetrics,
  opportunities: OptimizationOpportunity[],
  agg: ModuleAggregates,
): RunwayOptimization {
  // Sum savings per module, capped at that module's monthly spend.
  const perModuleSaved: Record<string, number> = {};
  for (const o of opportunities) {
    perModuleSaved[o.module] =
      (perModuleSaved[o.module] ?? 0) + o.savings.potential_monthly_savings_credits;
  }
  let monthlySaved = 0;
  for (const [mod, saved] of Object.entries(perModuleSaved)) {
    monthlySaved += Math.min(saved, agg.monthlyCredits[mod] ?? saved);
  }
  // Can't save more than is currently burned.
  monthlySaved = Math.min(monthlySaved, metrics.monthly_burn_rate);

  const currentDaily = metrics.daily_burn_rate;
  const optimizedDaily = Math.max(0, currentDaily - monthlySaved / 30);
  const remaining = metrics.credits_remaining;

  const currentRunway = runwayDays(remaining, currentDaily);
  const optimizedRunway = runwayDays(remaining, optimizedDaily);

  return {
    current_runway_days: currentRunway,
    optimized_runway_days: optimizedRunway,
    additional_days_gained:
      currentRunway !== null && optimizedRunway !== null
        ? round1(optimizedRunway - currentRunway)
        : optimizedRunway !== null && currentRunway === null
          ? null
          : null,
    current_daily_burn: round1(currentDaily),
    optimized_daily_burn: round1(optimizedDaily),
    monthly_credits_saved: Math.round(monthlySaved),
    applied_opportunities: opportunities.map((o) => o.category),
  };
}
