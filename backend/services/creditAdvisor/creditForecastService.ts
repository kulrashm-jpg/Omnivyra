/**
 * Credit Advisor — Phase 3: Forecast Engine.
 *
 * Deterministic runway / exhaustion projection from burn rate + remaining
 * balance. No AI. READ-ONLY (pure functions over already-read metrics).
 */

import type {
  ConsumptionMetrics,
  ForecastResult,
  RiskLevel,
  WalletOverview,
} from './creditAdvisorTypes';

const DAY_MS = 86_400_000;

function daysLeftInMonth(now = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
  end.setHours(23, 59, 59, 999);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

function riskForDays(days: number | null): RiskLevel {
  if (days === null) return 'Healthy'; // ~zero burn → no exhaustion pressure
  if (days < 7) return 'Critical';
  if (days < 15) return 'At Risk';
  if (days < 30) return 'Monitor';
  return 'Healthy';
}

/**
 * Project runway and month-end position.
 *
 * @param metrics  consumption metrics (burn rate + remaining)
 * @param overview wallet overview (for consumed-this-period context)
 * @param consumedThisMonth credits already consumed in the current calendar month
 */
export function computeForecast(
  metrics: ConsumptionMetrics,
  consumedThisMonth: number,
  now = new Date(),
): ForecastResult {
  const remaining = metrics.credits_remaining;
  const burn = metrics.daily_burn_rate;
  const daysLeft = daysLeftInMonth(now);

  // days_remaining = remaining / daily_burn_rate (spec formula). Null when burn ~0.
  const days_remaining = burn > 0.0001 ? remaining / burn : null;

  const projected_exhaustion_date =
    days_remaining !== null && Number.isFinite(days_remaining)
      ? new Date(now.getTime() + days_remaining * DAY_MS).toISOString().slice(0, 10)
      : null;

  const projected_month_end_consumption = consumedThisMonth + burn * daysLeft;
  const projected_month_end_balance = remaining - burn * daysLeft;

  return {
    days_remaining: days_remaining === null ? null : Math.round(days_remaining * 10) / 10,
    projected_exhaustion_date,
    projected_month_end_consumption: Math.round(projected_month_end_consumption),
    projected_month_end_balance: Math.round(projected_month_end_balance),
    subscription_exhaustion_risk: riskForDays(days_remaining),
    days_left_in_month: daysLeft,
  };
}

/** Convenience: risk level from a wallet overview + metrics without month context. */
export function quickRisk(metrics: ConsumptionMetrics): RiskLevel {
  const days = metrics.daily_burn_rate > 0.0001
    ? metrics.credits_remaining / metrics.daily_burn_rate
    : null;
  return riskForDays(days);
}

/**
 * Runway in days for a given remaining balance + daily burn. null when burn ≈ 0.
 */
export function runwayDays(remaining: number, dailyBurn: number): number | null {
  return dailyBurn > 0.0001 ? Math.round((remaining / dailyBurn) * 10) / 10 : null;
}

/**
 * How many additional days of runway are gained by saving `monthlySavings`
 * credits/month, given current remaining + daily burn. Returns the optimized
 * runway and the day delta. Deterministic.
 */
export function runwayGainFromMonthlySavings(
  remaining: number,
  currentDailyBurn: number,
  monthlySavings: number,
): { optimized_runway_days: number | null; gain_days: number | null } {
  const current = runwayDays(remaining, currentDailyBurn);
  const optimizedDaily = Math.max(0, currentDailyBurn - Math.max(0, monthlySavings) / 30);
  const optimized = runwayDays(remaining, optimizedDaily);
  const gain =
    current !== null && optimized !== null ? Math.round((optimized - current) * 10) / 10 : null;
  return { optimized_runway_days: optimized, gain_days: gain };
}

export { daysLeftInMonth };
