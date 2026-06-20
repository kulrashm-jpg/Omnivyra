/**
 * Credit Advisor — Phase 11: Consumption Optimization Advisor (facade).
 *
 * Moves beyond reporting: composes automation visibility, the deterministic
 * optimization opportunity engine, driver analysis, the what-if simulator, the
 * runway optimizer, and the upgrade advisor into one report.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SAFETY (Phase 21) — READ-ONLY. SELECT-only reads; no writes; never deducts,
 * purchases, upgrades, or modifies any plan/subscription/billing state.
 * ───────────────────────────────────────────────────────────────────────────
 */

import {
  loadConsumptionRows,
  getWalletOverview,
  computeConsumptionMetrics,
  type ConsumptionRow,
} from './consumptionMetricsService';
import { computeAttribution } from './consumptionAttributionService';
import { computeForecast } from './creditForecastService';
import { computeModuleAggregates } from './optimizationAggregates';
import { buildAutomationReport } from './automationConsumptionService';
import { generateOpportunities } from './optimizationOpportunityEngine';
import { analyzeDrivers } from './consumptionDriverAnalysisService';
import { simulateScenarios } from './consumptionScenarioService';
import { optimizeRunway } from './runwayOptimizationService';
import { computeUpgradeAdvice } from './upgradeAdvisorService';
import { resolveOrganizationPlanLimits } from '@/backend/services/planResolutionService';
import type { ConsumptionOptimizationReport } from './creditAdvisorTypes';

function consumedThisMonth(rows: ConsumptionRow[], now: Date): number {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let total = 0;
  for (const r of rows) {
    if (new Date(r.created_at).getTime() >= startOfMonth) total += r.credits;
  }
  return total;
}

async function resolvePlanName(orgId: string): Promise<string> {
  try {
    const resolved = await resolveOrganizationPlanLimits(orgId);
    return (resolved?.plan_key ?? 'current plan').toString();
  } catch {
    return 'current plan';
  }
}

export async function getConsumptionOptimizationReport(
  orgId: string,
  windowDays = 30,
): Promise<ConsumptionOptimizationReport> {
  const days = Math.min(Math.max(7, windowDays), 90);
  const now = new Date();

  const [rows, overview, planName] = await Promise.all([
    loadConsumptionRows(orgId, days),
    getWalletOverview(orgId),
    resolvePlanName(orgId),
  ]);

  const metrics = await computeConsumptionMetrics(orgId, days, { rows, overview });
  const attribution = computeAttribution(rows, days);
  const forecast = computeForecast(metrics, consumedThisMonth(rows, now), now);
  const agg = computeModuleAggregates(rows, days);

  const automations = buildAutomationReport(agg.monthlyCredits, overview.credit_rate_usd, days);
  const opportunities = generateOpportunities(agg);
  const drivers = analyzeDrivers(attribution.by_module, agg);
  const runway = optimizeRunway(metrics, opportunities, agg);
  const scenarios = simulateScenarios(metrics, agg, now);
  const upgrade = computeUpgradeAdvice(planName, forecast, runway);

  return {
    organization_id: orgId,
    generated_at: now.toISOString(),
    automations,
    opportunities,
    drivers,
    runway,
    upgrade,
    scenarios,
    total_potential_monthly_savings: runway.monthly_credits_saved,
  };
}
