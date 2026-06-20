/**
 * Credit Advisor — Phase 16: What-If Scenario Simulator.
 *
 * READ-ONLY simulation. Given a scenario (disable Market Pulse, reduce campaign
 * duration/platforms, reduce lead coverage, reduce creator usage, standard
 * content variants), project credits saved, runway increase, and month-end
 * balance — all deterministically from observed module spend. No mutations.
 */

import { SCENARIO_DEFS } from './optimizationKnowledgeBase';
import { daysLeftInMonth } from './creditForecastService';
import type { ModuleAggregates } from './optimizationAggregates';
import type { ConsumptionMetrics, ScenarioResult } from './creditAdvisorTypes';

const round1 = (n: number) => Math.round(n * 10) / 10;

function runwayDays(remaining: number, dailyBurn: number): number | null {
  return dailyBurn > 0.0001 ? round1(remaining / dailyBurn) : null;
}

/**
 * Simulate every defined scenario for an org.
 *
 * @param metrics  consumption metrics (current burn + remaining)
 * @param agg      module aggregates (monthly credits per module)
 * @param now      injected for determinism in tests
 */
export function simulateScenarios(
  metrics: ConsumptionMetrics,
  agg: ModuleAggregates,
  now = new Date(),
): ScenarioResult[] {
  const remaining = metrics.credits_remaining;
  const currentDaily = metrics.daily_burn_rate;
  const currentRunway = runwayDays(remaining, currentDaily);
  const daysLeft = daysLeftInMonth(now);
  const currentMonthEnd = Math.round(remaining - currentDaily * daysLeft);

  return SCENARIO_DEFS.map((s) => {
    const moduleMonthly = agg.monthlyCredits[s.module] ?? 0;
    const monthlySaved = Math.round(moduleMonthly * s.reduction_ratio);
    const dailySaved = monthlySaved / 30;
    const newDaily = Math.max(0, currentDaily - dailySaved);
    const newRunway = runwayDays(remaining, newDaily);
    const projectedMonthEnd = Math.round(remaining - newDaily * daysLeft);

    return {
      scenario: s.id,
      label: s.label,
      projected_credits_saved_monthly: monthlySaved,
      current_runway_days: currentRunway,
      projected_runway_days: newRunway,
      runway_increase_days:
        currentRunway !== null && newRunway !== null
          ? round1(newRunway - currentRunway)
          : null,
      current_month_end_balance: currentMonthEnd,
      projected_month_end_balance: projectedMonthEnd,
    };
  }).sort((a, b) => b.projected_credits_saved_monthly - a.projected_credits_saved_monthly);
}
