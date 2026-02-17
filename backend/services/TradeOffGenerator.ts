/**
 * Strategic trade-off layer for duration negotiation.
 * Proposes viable adjustment paths when status === NEGOTIATE.
 */

import type { ConstraintResult, TradeOffOption } from '../types/CampaignDuration';

export interface TradeOffGeneratorParams {
  requestedDurationWeeks: number;
  requestedPostsPerWeek: number;
  totalInventory: number;
  maxWeeksAllowed?: number;
  minWeeksRequired?: number;
  limitingConstraints: ConstraintResult[];
  availableCapacity?: number;
}

export function generateTradeOffOptions(params: TradeOffGeneratorParams): TradeOffOption[] {
  const options: TradeOffOption[] = [];
  const {
    requestedDurationWeeks,
    requestedPostsPerWeek,
    totalInventory,
    maxWeeksAllowed,
    minWeeksRequired,
    limitingConstraints,
    availableCapacity,
  } = params;

  const hasCapacityConstraint =
    limitingConstraints.some((c) => c.name === 'production_capacity' || c.name === 'team_overlap');

  // Option A — EXTEND_DURATION (upward or downward adjustment to viable max)
  if (
    maxWeeksAllowed != null &&
    maxWeeksAllowed > 0 &&
    maxWeeksAllowed !== requestedDurationWeeks
  ) {
    options.push({
      type: 'EXTEND_DURATION',
      newDurationWeeks: maxWeeksAllowed,
      reasoning:
        maxWeeksAllowed > requestedDurationWeeks
          ? 'Extend campaign duration to align with available capacity.'
          : 'Reduce campaign duration to align with available constraints.',
    });
  }

  // Option B — REDUCE_FREQUENCY
  if (
    availableCapacity != null &&
    availableCapacity > 0 &&
    availableCapacity < requestedPostsPerWeek &&
    totalInventory > 0
  ) {
    const newPostsPerWeek = availableCapacity;
    const newDurationWeeks = Math.ceil(totalInventory / newPostsPerWeek);
    options.push({
      type: 'REDUCE_FREQUENCY',
      newPostsPerWeek,
      newDurationWeeks,
      reasoning: 'Reduce weekly posting frequency to match available team capacity.',
    });
  }

  // Option C — INCREASE_CAPACITY
  if (hasCapacityConstraint && availableCapacity != null && availableCapacity < requestedPostsPerWeek) {
    const requiredAdditionalCapacity = requestedPostsPerWeek - availableCapacity;
    options.push({
      type: 'INCREASE_CAPACITY',
      requiredAdditionalCapacity,
      reasoning: 'Increase team capacity to maintain requested campaign intensity.',
    });
  }

  // Option D — ADJUST_CONTENT_MIX (when content-type capacity limits)
  if (limitingConstraints.some((c) => c.name === 'content_type_capacity')) {
    options.push({
      type: 'ADJUST_CONTENT_MIX',
      reasoning: 'Adjust weekly content mix to match available asset types.',
    });
  }

  // Option E — ADJUST_CONTENT_SELECTION (when content collision limits)
  if (limitingConstraints.some((c) => c.name === 'content_collision')) {
    options.push({
      type: 'ADJUST_CONTENT_SELECTION',
      reasoning: 'Select different content assets for this campaign.',
    });
  }

  return options;
}

const TRADE_OFF_ORDER_NORMAL = [
  'SHIFT_START_DATE',
  'PREEMPT_LOWER_PRIORITY_CAMPAIGN',
  'REDUCE_FREQUENCY',
  'EXTEND_DURATION',
  'INCREASE_CAPACITY',
  'ADJUST_CONTENT_MIX',
  'ADJUST_CONTENT_SELECTION',
] as const;

const TRADE_OFF_ORDER_HIGH_CRITICAL = [
  'PREEMPT_LOWER_PRIORITY_CAMPAIGN',
  'SHIFT_START_DATE',
  'REDUCE_FREQUENCY',
  'EXTEND_DURATION',
  'INCREASE_CAPACITY',
  'ADJUST_CONTENT_MIX',
  'ADJUST_CONTENT_SELECTION',
] as const;

/**
 * Rank trade-offs in strategic order. Stable deterministic sorting.
 * When campaign is HIGH or CRITICAL: PREEMPT first. Otherwise: SHIFT_START_DATE first.
 */
export function rankTradeOffOptions(
  options: TradeOffOption[],
  campaignPriorityLevel?: string | null
): TradeOffOption[] {
  const level = String(campaignPriorityLevel || 'NORMAL').toUpperCase();
  const order = level === 'HIGH' || level === 'CRITICAL' ? TRADE_OFF_ORDER_HIGH_CRITICAL : TRADE_OFF_ORDER_NORMAL;
  const rankMap: Record<string, number> = {};
  order.forEach((t, i) => {
    rankMap[t] = i;
  });
  return [...options].sort((a, b) => {
    const rankA = rankMap[a.type] ?? 999;
    const rankB = rankMap[b.type] ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return 0;
  });
}
