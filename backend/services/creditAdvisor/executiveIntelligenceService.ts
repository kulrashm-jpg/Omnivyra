/**
 * Credit Advisor — Phase 3 facade: Executive Intelligence.
 *
 * Builds the compact, executive-grade payload that powers the proactive popup
 * (Phase 23/25/30) and the command-center banner (Phase 32): runway, health,
 * largest driver, automation runway impact (Phase 26), frequency optimizations
 * (Phase 27/29), top-3 actions (Phase 30), optimization-before-upgrade advice
 * (Phase 28), and the smart-display signals (Phase 31).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SAFETY (Phase 35) — READ-ONLY. SELECT-only reads; recommends and simulates
 * only. Never deducts/modifies credits, plans, subscriptions, or automations.
 * ───────────────────────────────────────────────────────────────────────────
 */

import {
  loadConsumptionRows,
  getWalletOverview,
  computeConsumptionMetrics,
  type ConsumptionRow,
} from './consumptionMetricsService';
import { computeAttribution } from './consumptionAttributionService';
import { computeForecast, runwayGainFromMonthlySavings } from './creditForecastService';
import { computeHealthScore } from './creditHealthScoreService';
import { computeModuleAggregates } from './optimizationAggregates';
import { buildAutomationReport } from './automationConsumptionService';
import { generateOpportunities } from './optimizationOpportunityEngine';
import { analyzeDrivers } from './consumptionDriverAnalysisService';
import { optimizeRunway } from './runwayOptimizationService';
import { computeUpgradeAdvice } from './upgradeAdvisorService';
import { AUTOMATION_REGISTRY } from './optimizationKnowledgeBase';
import { resolveOrganizationPlanLimits } from '@/backend/services/planResolutionService';
import type {
  AutomationRunwayRow,
  DeepLinkSection,
  ExecutiveDisplaySignals,
  ExecutiveIntelligenceReport,
  FrequencyOptimization,
  RiskLevel,
  TopAction,
} from './creditAdvisorTypes';

function consumedThisMonth(rows: ConsumptionRow[], now: Date): number {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let total = 0;
  for (const r of rows) if (new Date(r.created_at).getTime() >= startOfMonth) total += r.credits;
  return total;
}

async function resolvePlanName(orgId: string): Promise<string> {
  try {
    const r = await resolveOrganizationPlanLimits(orgId);
    return (r?.plan_key ?? 'current plan').toString();
  } catch {
    return 'current plan';
  }
}

function runwayBucket(days: number | null): string {
  if (days === null) return 'inf';
  if (days < 7) return 'crit';
  if (days < 15) return 'low';
  if (days < 30) return 'mon';
  return 'ok';
}

export async function getExecutiveIntelligence(
  orgId: string,
  windowDays = 30,
): Promise<ExecutiveIntelligenceReport> {
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
  const health = computeHealthScore(metrics, forecast, attribution, overview);
  const agg = computeModuleAggregates(rows, days);

  const automations = buildAutomationReport(agg.monthlyCredits, overview.credit_rate_usd, days);
  const opportunities = generateOpportunities(agg);
  const drivers = analyzeDrivers(attribution.by_module, agg);
  const runway = optimizeRunway(metrics, opportunities, agg);
  const upgrade = computeUpgradeAdvice(planName, forecast, runway);

  const remaining = metrics.credits_remaining;
  const dailyBurn = metrics.daily_burn_rate;
  const monthlyBurn = metrics.monthly_burn_rate;
  const totalAutomationMonthly = automations.total_monthly_credits;

  // ── Phase 26: Automation runway intelligence ──────────────────────────────
  const denom = Math.max(monthlyBurn, totalAutomationMonthly, 1);
  const automation_runway: AutomationRunwayRow[] = automations.rows
    .filter((a) => a.estimated_monthly_credits > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      monthly_credits: a.estimated_monthly_credits,
      pct_of_consumption: Math.round((a.estimated_monthly_credits / denom) * 1000) / 10,
      runway_days_lost: runwayGainFromMonthlySavings(remaining, dailyBurn, a.estimated_monthly_credits)
        .gain_days,
      classification: a.classification,
    }))
    .slice(0, 8);

  // ── Phase 27/29: Frequency optimizations ─────────────────────────────────
  const automationCreditsById = new Map(
    automations.rows.map((a) => [a.id, a.estimated_monthly_credits]),
  );
  const frequency_optimizations: FrequencyOptimization[] = AUTOMATION_REGISTRY.filter(
    (def) => def.recommended_frequency_label && def.frequency_savings_ratio,
  )
    .map((def) => {
      const current = automationCreditsById.get(def.id) ?? 0;
      const savings = Math.round(current * (def.frequency_savings_ratio ?? 0));
      const gain = runwayGainFromMonthlySavings(remaining, dailyBurn, savings).gain_days;
      return {
        id: def.id,
        name: def.name,
        current_frequency: def.frequency_label ?? def.cadence_label,
        recommended_frequency: def.recommended_frequency_label ?? '',
        current_monthly_credits: current,
        optimized_monthly_credits: current - savings,
        potential_savings_credits: savings,
        runway_gain_days: gain,
        tradeoff: def.frequency_tradeoff ?? '',
        deep_link: 'automation' as DeepLinkSection,
      };
    })
    .filter((f) => f.potential_savings_credits > 0)
    .sort((a, b) => b.potential_savings_credits - a.potential_savings_credits);

  // ── Phase 30: Top 3 actions (opportunities + frequency optimizations) ─────
  const opportunityActions: Array<Omit<TopAction, 'rank'>> = opportunities.map((o) => ({
    title: o.category,
    savings_credits: o.savings.potential_monthly_savings_credits,
    runway_gain_days: runwayGainFromMonthlySavings(
      remaining,
      dailyBurn,
      o.savings.potential_monthly_savings_credits,
    ).gain_days,
    deep_link: 'opportunities' as DeepLinkSection,
  }));
  const frequencyActions: Array<Omit<TopAction, 'rank'>> = frequency_optimizations.map((f) => ({
    title: `Reduce ${f.name} frequency (${f.current_frequency} → ${f.recommended_frequency})`,
    savings_credits: f.potential_savings_credits,
    runway_gain_days: f.runway_gain_days,
    tradeoff: f.tradeoff,
    deep_link: 'automation' as DeepLinkSection,
  }));

  const top_actions: TopAction[] = [...opportunityActions, ...frequencyActions]
    .sort((a, b) => b.savings_credits - a.savings_credits)
    .slice(0, 3)
    .map((a, i) => ({ rank: i + 1, ...a }));

  const largest_driver =
    drivers[0] && drivers[0].credits > 0
      ? { module: drivers[0].module, percentage: drivers[0].percentage }
      : null;

  // ── Phase 31: Smart display signals ───────────────────────────────────────
  const opportunity_pct = monthlyBurn > 0
    ? Math.min(100, Math.round((runway.monthly_credits_saved / monthlyBurn) * 1000) / 10)
    : 0;
  const exhaustion_within_30d =
    forecast.days_remaining !== null && forecast.days_remaining < 30;
  const consumption_spike =
    dailyBurn > 0.0001 && metrics.recent_daily_burn_rate > dailyBurn * 1.25;
  const healthy_and_low_opportunity =
    (health.band === 'Healthy' || health.band === 'Excellent') && opportunity_pct < 10;
  const risk: RiskLevel = forecast.subscription_exhaustion_risk;
  // Phase 31: positive triggers (risk / exhaustion <30d / spike >25% / opportunity ≥10%)
  // are honored directly. The "Healthy AND opportunity <10%" suppression is the
  // natural negation — it yields false only when NO positive trigger fires — so a
  // genuine spike still surfaces the popup even on an otherwise-healthy runway.
  const base_should_show =
    risk !== 'Healthy' || exhaustion_within_30d || consumption_spike || opportunity_pct >= 10;

  const display: ExecutiveDisplaySignals = {
    risk,
    runway_days: forecast.days_remaining,
    exhaustion_within_30d,
    opportunity_pct,
    consumption_spike,
    healthy_and_low_opportunity,
    base_should_show,
    signature: `${risk}|${Math.round(opportunity_pct / 10)}|${runwayBucket(forecast.days_remaining)}`,
  };

  return {
    organization_id: orgId,
    generated_at: now.toISOString(),
    summary: {
      credits_remaining: remaining,
      runway_days: forecast.days_remaining,
      projected_exhaustion_date: forecast.projected_exhaustion_date,
      health_band: health.band,
      risk,
      largest_driver,
      optimization_potential_credits: runway.monthly_credits_saved,
      optimization_runway_gain_days: runway.additional_days_gained,
    },
    automation_runway,
    frequency_optimizations,
    top_actions,
    upgrade,
    banner: {
      health_band: health.band,
      risk,
      runway_days: forecast.days_remaining,
      largest_driver,
      top_recommendation: top_actions[0] ?? null,
    },
    display,
  };
}
