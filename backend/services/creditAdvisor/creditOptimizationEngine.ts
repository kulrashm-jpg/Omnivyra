/**
 * Credit Advisor — Phase 5: Optimization Engine.
 *
 * DETERMINISTIC, RULES-ONLY recommendation engine. NO LLM. NO AI.
 * Each rule is a pure function of already-computed metrics/attribution/forecast.
 *
 * Rules:
 *   A. High Consumption Activity   — single activity > 40%
 *   B. Credit Exhaustion Risk      — projected exhaustion < 15 days
 *   C. Under Utilization           — remaining > 50% AND month > 75% complete
 *   D. Deep Variant Overuse        — deep variants > 50% of an activity's usage
 *   E. Campaign Heavy Usage        — campaigns > 35% of consumption
 */

import { isDeepVariant } from './creditAdvisorTaxonomy';
import type { ConsumptionRow } from './consumptionMetricsService';
import type {
  AttributionResult,
  ConsumptionMetrics,
  ForecastResult,
  Recommendation,
  WalletOverview,
} from './creditAdvisorTypes';

const HIGH_ACTIVITY_PCT = 40;
const EXHAUSTION_DAYS = 15;
const UNDER_UTIL_REMAINING_PCT = 50;
const MONTH_COMPLETE_PCT = 75;
const DEEP_VARIANT_PCT = 50;
const CAMPAIGN_HEAVY_PCT = 35;

export interface OptimizationInputs {
  metrics: ConsumptionMetrics;
  forecast: ForecastResult;
  attribution: AttributionResult;
  overview: WalletOverview;
  rows: ConsumptionRow[];
  now?: Date;
}

/** Rule A — a single activity dominates spend. */
function ruleA(attribution: AttributionResult): Recommendation | null {
  const top = attribution.by_activity[0];
  if (!top || top.percentage <= HIGH_ACTIVITY_PCT) return null;
  return {
    rule: 'A',
    category: 'High Consumption Activity',
    severity: 'info',
    title: `"${top.label}" is your largest credit consumer`,
    detail: `${top.label} accounts for ${top.percentage}% of credit spend in the current window. Review whether its frequency or variant depth can be reduced.`,
    impact: `${top.label} = ${top.percentage}% (${top.credits} credits)`,
  };
}

/** Rule B — runway is short. */
function ruleB(forecast: ForecastResult): Recommendation | null {
  if (forecast.days_remaining === null || forecast.days_remaining >= EXHAUSTION_DAYS) return null;
  return {
    rule: 'B',
    category: 'Credit Exhaustion Risk',
    severity: forecast.days_remaining < 7 ? 'critical' : 'warn',
    title: `Credits projected to run out in ~${forecast.days_remaining} days`,
    detail: `At the current burn rate, the balance is on track to deplete${forecast.projected_exhaustion_date ? ` around ${forecast.projected_exhaustion_date}` : ''}. Consider a top-up or reducing high-cost activity.`,
    impact: `Runway ${forecast.days_remaining}d · risk ${forecast.subscription_exhaustion_risk}`,
  };
}

/** Rule C — under-utilization late in the month. */
function ruleC(
  metrics: ConsumptionMetrics,
  overview: WalletOverview,
  now: Date,
): Recommendation | null {
  // Period budget proxy = remaining + credits consumed this 30d window.
  const periodBudget = overview.remaining + metrics.credits_used_30d;
  if (periodBudget <= 0) return null;
  const remainingPct = (overview.remaining / periodBudget) * 100;

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthCompletePct = (dayOfMonth / daysInMonth) * 100;

  if (remainingPct <= UNDER_UTIL_REMAINING_PCT || monthCompletePct <= MONTH_COMPLETE_PCT) {
    return null;
  }
  return {
    rule: 'C',
    category: 'Under Utilization',
    severity: 'info',
    title: 'Credits are under-utilized this period',
    detail: `${Math.round(remainingPct)}% of this period's credits remain with the month ${Math.round(monthCompletePct)}% complete. There is headroom to run more content, campaigns, or reports.`,
    impact: `${Math.round(remainingPct)}% remaining at ${Math.round(monthCompletePct)}% of month`,
  };
}

/** Rule D — deep/heavy variants dominate a given activity. */
function ruleD(rows: ConsumptionRow[]): Recommendation | null {
  // Group credits by activity, tracking deep-variant share.
  const totals = new Map<string, { total: number; deep: number }>();
  for (const r of rows) {
    const t = totals.get(r.action) ?? { total: 0, deep: 0 };
    t.total += r.credits;
    if (isDeepVariant(r.action)) t.deep += r.credits;
    totals.set(r.action, t);
  }
  // Aggregate deep share across all activities that have any deep usage.
  let totalCredits = 0;
  let deepCredits = 0;
  for (const t of totals.values()) {
    totalCredits += t.total;
    deepCredits += t.deep;
  }
  if (totalCredits <= 0) return null;
  const deepPct = (deepCredits / totalCredits) * 100;
  if (deepPct <= DEEP_VARIANT_PCT) return null;
  return {
    rule: 'D',
    category: 'Deep Variant Overuse',
    severity: 'info',
    title: 'Heavy "deep" variants dominate your usage',
    detail: `${Math.round(deepPct)}% of credits go to deep/long variants. Lighter variants (standard scans, shorter content) cover many use cases at a fraction of the cost.`,
    impact: `Deep variants = ${Math.round(deepPct)}% of spend`,
  };
}

/** Rule E — campaigns are a heavy share of consumption. */
function ruleE(attribution: AttributionResult): Recommendation | null {
  const campaigns = attribution.by_module.find((m) => m.key === 'Campaigns');
  if (!campaigns || campaigns.percentage <= CAMPAIGN_HEAVY_PCT) return null;
  return {
    rule: 'E',
    category: 'Campaign Heavy Usage',
    severity: 'info',
    title: 'Campaigns drive most of your credit spend',
    detail: `Campaigns account for ${campaigns.percentage}% of consumption. Campaign cost scales with frequency × duration × platforms — trimming any of these reduces spend the most.`,
    impact: `Campaigns = ${campaigns.percentage}% (${campaigns.credits} credits)`,
  };
}

/** Evaluate all rules. Returns recommendations ordered by severity. */
export function generateRecommendations(inputs: OptimizationInputs): Recommendation[] {
  const now = inputs.now ?? new Date();
  const recs = [
    ruleB(inputs.forecast),
    ruleA(inputs.attribution),
    ruleE(inputs.attribution),
    ruleD(inputs.rows),
    ruleC(inputs.metrics, inputs.overview, now),
  ].filter((r): r is Recommendation => r !== null);

  const order: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
