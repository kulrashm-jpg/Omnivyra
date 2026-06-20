/**
 * Credit Advisor — Phase 8: Credit Health Score (0–100).
 *
 * Deterministic weighted score from five factors: burn rate, remaining
 * credits, concentration risk, forecast, and utilization. No AI. READ-ONLY.
 */

import type {
  AttributionResult,
  ConsumptionMetrics,
  ForecastResult,
  HealthBand,
  HealthScoreResult,
  WalletOverview,
} from './creditAdvisorTypes';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function bandFor(score: number): HealthBand {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Monitor';
  if (score >= 30) return 'At Risk';
  return 'Critical';
}

export function computeHealthScore(
  metrics: ConsumptionMetrics,
  forecast: ForecastResult,
  attribution: AttributionResult,
  overview: WalletOverview,
): HealthScoreResult {
  // Runway factor: 30+ days → 100, linear to 0 at 0 days. Null burn → full.
  const runway =
    forecast.days_remaining === null
      ? 100
      : clamp((forecast.days_remaining / 30) * 100);

  // Remaining factor: share of period budget still available.
  const periodBudget = overview.remaining + metrics.credits_used_30d;
  const remaining = periodBudget > 0 ? clamp((overview.remaining / periodBudget) * 100) : 100;

  // Concentration factor: 100 when spend is spread out; lower when one module dominates.
  const topModulePct = attribution.by_module[0]?.percentage ?? 0;
  const concentration = clamp(100 - Math.max(0, topModulePct - 30) * 1.4);

  // Forecast factor: positive projected month-end balance is healthy.
  const forecastFactor = forecast.projected_month_end_balance >= 0
    ? 100
    : clamp(100 + (forecast.projected_month_end_balance / Math.max(1, overview.remaining)) * 100);

  // Utilization factor: penalize both near-zero use and near-exhaustion.
  // Sweet spot ~ moderate, steady burn.
  let utilization = 100;
  if (forecast.days_remaining !== null) {
    if (forecast.days_remaining < 15) utilization = clamp((forecast.days_remaining / 15) * 100);
    else if (metrics.credits_used_30d === 0) utilization = 60; // idle subscription
  } else if (metrics.credits_used_30d === 0) {
    utilization = 60;
  }

  const factors = {
    runway: Math.round(runway),
    remaining: Math.round(remaining),
    concentration: Math.round(concentration),
    forecast: Math.round(forecastFactor),
    utilization: Math.round(utilization),
  };

  // Weighted: runway + forecast dominate (exhaustion is the real risk).
  const score = Math.round(
    runway * 0.3 +
      forecastFactor * 0.25 +
      remaining * 0.2 +
      concentration * 0.15 +
      utilization * 0.1,
  );

  return { score: clamp(score), band: bandFor(clamp(score)), factors };
}
