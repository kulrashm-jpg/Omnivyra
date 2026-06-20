/**
 * Credit Advisor — facade.
 *
 * Composes the consumption / forecast / attribution / optimization / health
 * layers into a single read-only report for the dashboard endpoint.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SAFETY CONTRACT (Phase 9) — this entire module tree is READ-ONLY.
 * It performs only SELECT queries against existing tables
 * (credit_usage_log, organization_credits, credit_cost_config via resolver).
 * It does NOT and MUST NOT: modify credits, deduct, hold, grant, refund,
 * change subscriptions, plans, or top-ups, or write to any table. It does not
 * import the credit execution / deduction write path.
 * ───────────────────────────────────────────────────────────────────────────
 */

import {
  computeConsumptionMetrics,
  getWalletOverview,
  loadConsumptionRows,
  type ConsumptionRow,
} from './consumptionMetricsService';
import { computeForecast } from './creditForecastService';
import { computeForecastStrategy } from './forecastStrategyService';
import { computeAttribution } from './consumptionAttributionService';
import { computeCoverage } from './attributionCoverageService';
import { detectSpike } from './spikeIntelligenceService';
import { computeConfidence } from './forecastConfidenceService';
import { generateRecommendations } from './creditOptimizationEngine';
import { computeHealthScore } from './creditHealthScoreService';
import type { CreditAdvisorReport } from './creditAdvisorTypes';

const DAY_MS = 86_400_000;

function consumedThisMonth(rows: ConsumptionRow[], now = new Date()): number {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let total = 0;
  for (const r of rows) {
    if (new Date(r.created_at).getTime() >= startOfMonth) total += r.credits;
  }
  return total;
}

/**
 * Produce the complete Credit Advisor report for an org.
 * `windowDays` controls the analysis window (default 30, max 90).
 */
export async function getCreditAdvisorReport(
  orgId: string,
  windowDays = 30,
): Promise<CreditAdvisorReport> {
  const days = Math.min(Math.max(7, windowDays), 90);
  const now = new Date();

  // Single read of each source; shared downstream.
  const [rows, overview] = await Promise.all([
    loadConsumptionRows(orgId, days),
    getWalletOverview(orgId),
  ]);

  const metrics = await computeConsumptionMetrics(orgId, days, { rows, overview });
  const attribution = computeAttribution(rows, days);
  const forecast = computeForecast(metrics, consumedThisMonth(rows, now), now);
  const forecast_strategy = computeForecastStrategy(rows, overview.remaining, now);
  const coverage = computeCoverage(rows);
  const spike = detectSpike(rows, overview.remaining, now);
  const confidence = computeConfidence(rows, coverage.coverage_pct, spike.magnitude, now);
  const health = computeHealthScore(metrics, forecast, attribution, overview);
  const recommendations = generateRecommendations({
    metrics,
    forecast,
    attribution,
    overview,
    rows,
    now,
  });

  return {
    organization_id: orgId,
    generated_at: now.toISOString(),
    overview,
    metrics,
    forecast,
    forecast_strategy,
    confidence,
    spike,
    coverage,
    attribution,
    recommendations,
    health,
  };
}
