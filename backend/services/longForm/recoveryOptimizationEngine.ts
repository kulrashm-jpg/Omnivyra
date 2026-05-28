/**
 * Phase 7 — Recovery optimization engine.
 *
 * Walks `recovery_action_outcome` events to learn:
 *   - per-action success rates
 *   - per-action cost distribution
 *   - recommended ordering (cheapest_first / success_weighted / integrity_weighted)
 *   - regeneration-avoidance rate
 *
 * Output guides downstream recovery coordinators to prefer high-success
 * cheap actions before falling back to regeneration.
 */

import type {
  FeedbackEvent,
  RecoveryOptimizationOutputs,
  RecoveryStrategyMode,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

const COST_RANK: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };

export interface OptimizeRecoveryInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  windowSinceISO?: string;
}

export function optimizeRecovery(input: OptimizeRecoveryInput): RecoveryOptimizationOutputs {
  const events = input.registry.list(input.companyId, { sinceISO: input.windowSinceISO })
    .filter((e): e is FeedbackEvent & { recoveryOutcome: NonNullable<FeedbackEvent['recoveryOutcome']> } =>
      e.eventType === 'recovery_action_outcome' && !!e.recoveryOutcome);

  if (events.length === 0) {
    return {
      optimizedActionOrdering: [],
      regenerationAvoidanceRatePercent: 0,
      averageRecoveryCostBand: 'low',
      recommendedStrategy: 'cheapest_first',
    };
  }

  // Group by action.
  const byAction = new Map<string, FeedbackEvent[]>();
  for (const e of events) {
    const a = e.recoveryOutcome!.action;
    const arr = byAction.get(a) ?? [];
    arr.push(e);
    byAction.set(a, arr);
  }

  type ActionRow = {
    action: string;
    sampleSize: number;
    successCount: number;
    successRatePercent: number;
    previousAvgCost: 'low' | 'medium' | 'high';
  };

  const rows: ActionRow[] = [];
  for (const [action, list] of byAction) {
    const successCount = list.filter((e) => e.recoveryOutcome!.succeeded).length;
    const sampleSize = list.length;
    const successRatePercent = Math.round((successCount / sampleSize) * 100);
    const avgCostRank = list.reduce((sum, e) => sum + COST_RANK[e.recoveryOutcome!.costBand], 0) / sampleSize;
    const previousAvgCost: 'low' | 'medium' | 'high' =
      avgCostRank <= 1.34 ? 'low'
      : avgCostRank <= 2.34 ? 'medium'
      : 'high';
    rows.push({ action, sampleSize, successCount, successRatePercent, previousAvgCost });
  }

  // Recommended strategy:
  // - if regeneration appears often but success is low → integrity_weighted (avoid)
  // - if cheap actions dominate AND high success → cheapest_first
  // - else success_weighted
  const regenRow = rows.find((r) => /regenerate/i.test(r.action));
  const regenSuccess = regenRow ? regenRow.successRatePercent : 100;
  const cheapHighSuccess = rows.filter((r) => r.previousAvgCost === 'low' && r.successRatePercent >= 70).length;
  let recommendedStrategy: RecoveryStrategyMode = 'cheapest_first';
  if (regenRow && regenSuccess < 50) {
    recommendedStrategy = 'integrity_weighted';
  } else if (cheapHighSuccess >= 2 && rows.length >= 3) {
    recommendedStrategy = 'success_weighted';
  }

  // Priority assignment: by success rate first (high → low), tiebreak by lower cost.
  const orderedRows = [...rows].sort((a, b) => {
    if (b.successRatePercent !== a.successRatePercent) return b.successRatePercent - a.successRatePercent;
    return COST_RANK[a.previousAvgCost] - COST_RANK[b.previousAvgCost];
  });
  const optimizedActionOrdering: RecoveryOptimizationOutputs['optimizedActionOrdering'] = orderedRows.map((r, i) => ({
    action: r.action,
    previousAvgCost: r.previousAvgCost,
    recommendedPriority: i + 1,
    successRatePercent: r.successRatePercent,
    sampleSize: r.sampleSize,
  }));

  // Regeneration avoidance: fraction of recovery events that did NOT use a regenerate action.
  const totalEvents = events.length;
  const regenEventCount = events.filter((e) => /regenerate/i.test(e.recoveryOutcome!.action)).length;
  const regenerationAvoidanceRatePercent = Math.round(((totalEvents - regenEventCount) / totalEvents) * 100);

  // Average recovery cost band.
  const avgCostRank = events.reduce((sum, e) => sum + COST_RANK[e.recoveryOutcome!.costBand], 0) / totalEvents;
  const averageRecoveryCostBand: 'low' | 'medium' | 'high' =
    avgCostRank <= 1.34 ? 'low'
    : avgCostRank <= 2.34 ? 'medium'
    : 'high';

  return {
    optimizedActionOrdering,
    regenerationAvoidanceRatePercent,
    averageRecoveryCostBand,
    recommendedStrategy,
  };
}
