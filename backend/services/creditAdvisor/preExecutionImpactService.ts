/**
 * Credit Advisor — Phase 7: Pre-Execution Impact Estimation.
 *
 * Before a credit-consuming action runs, surface its estimated credit cost and
 * what percentage of the remaining balance it would consume. READ-ONLY: it
 * reuses the existing fixed-cost catalog resolver (getCreditCost) and the
 * wallet read; it NEVER reserves, deducts, or holds credits.
 */

import { getCreditCost, type CreditAction } from '@/backend/services/creditDeductionService';
import { getWalletOverview, computeConsumptionMetrics } from './consumptionMetricsService';
import { ACTION_ALTERNATIVES } from './optimizationKnowledgeBase';
import type {
  EnhancedPreExecutionImpact,
  OptimizationAlternative,
  PreExecutionImpact,
} from './creditAdvisorTypes';

/**
 * Estimate the impact of a single action against an org's remaining balance.
 *
 * @param orgId       organization id
 * @param action      a CreditAction / action key (e.g. 'content_generation')
 * @param multiplier  optional quantity multiplier (e.g. campaign content rows)
 * @param variant     optional variant label for display
 * @param remaining   optional precomputed remaining balance (avoids a re-read)
 */
export async function estimateActionImpact(
  orgId: string,
  action: string,
  multiplier = 1,
  variant?: string | null,
  remaining?: number,
): Promise<PreExecutionImpact> {
  const remain =
    typeof remaining === 'number' ? remaining : (await getWalletOverview(orgId)).remaining;

  let estimated: number | null = null;
  let resolvable = false;
  let note: string | undefined;

  try {
    // getCreditCost throws for uncatalogued/token-priced actions; cast since the
    // advisor accepts arbitrary action keys and we handle the throw below.
    const unit = await getCreditCost(action as CreditAction);
    if (typeof unit === 'number' && Number.isFinite(unit)) {
      estimated = Math.max(0, Math.round(unit * Math.max(1, multiplier)));
      resolvable = true;
    }
  } catch {
    // Token-priced or uncatalogued action — cost is resolved at runtime from
    // model token usage and cannot be known precisely up front.
    note = 'Token-priced action — final cost depends on model token usage.';
  }

  const pct_of_remaining =
    estimated !== null && remain > 0
      ? Math.round((estimated / remain) * 1000) / 10
      : null;

  return {
    action,
    variant: variant ?? null,
    estimated_credits: estimated,
    pct_of_remaining,
    remaining: remain,
    resolvable,
    note,
  };
}

/**
 * Phase 20 — enhanced pre-execution impact: base estimate + runway impact (in
 * days of average burn), percentage of allocation, and cheaper alternatives.
 * READ-ONLY.
 */
export async function estimateEnhancedImpact(
  orgId: string,
  action: string,
  multiplier = 1,
  variant?: string | null,
): Promise<EnhancedPreExecutionImpact> {
  const overview = await getWalletOverview(orgId);
  const metrics = await computeConsumptionMetrics(orgId, 30, { overview });

  const base = await estimateActionImpact(orgId, action, multiplier, variant, overview.remaining);

  const runway_impact_days =
    base.estimated_credits !== null && metrics.daily_burn_rate > 0.0001
      ? Math.round((base.estimated_credits / metrics.daily_burn_rate) * 10) / 10
      : null;

  const pct_of_allocation =
    base.estimated_credits !== null && overview.allocated > 0
      ? Math.round((base.estimated_credits / overview.allocated) * 1000) / 10
      : null;

  // Cheaper alternative, if one is catalogued for this action.
  const alternatives: OptimizationAlternative[] = [];
  const alt = ACTION_ALTERNATIVES[action];
  if (alt) {
    let altCost: number | null = null;
    try {
      const c = await getCreditCost(alt.alternative_action as CreditAction);
      if (typeof c === 'number' && Number.isFinite(c)) altCost = Math.round(c * Math.max(1, multiplier));
    } catch {
      altCost = null;
    }
    alternatives.push({
      alternative_action: alt.alternative_action,
      alternative_label: alt.alternative_label,
      estimated_credits: altCost,
      estimated_savings_credits:
        altCost !== null && base.estimated_credits !== null
          ? Math.max(0, base.estimated_credits - altCost)
          : null,
    });
  }

  return { ...base, runway_impact_days, pct_of_allocation, alternatives };
}

/** Estimate impact for several actions at once (e.g. a dashboard preview row). */
export async function estimateBatchImpact(
  orgId: string,
  actions: Array<{ action: string; multiplier?: number; variant?: string | null }>,
): Promise<PreExecutionImpact[]> {
  const remaining = (await getWalletOverview(orgId)).remaining;
  return Promise.all(
    actions.map((a) =>
      estimateActionImpact(orgId, a.action, a.multiplier ?? 1, a.variant, remaining),
    ),
  );
}
