/**
 * Modular Campaign Duration Constraint Framework — Horizon Evaluator.
 * Evaluates requested duration against all constraints.
 * No negotiation logic — only evaluation.
 * Constraint-agnostic: max_weeks = min of all PASS/LIMITING ceilings.
 */

import type { ConstraintResult, DurationEvaluationResult, TradeOffOption } from '../types/CampaignDuration';
import { evaluatePortfolioConstraints } from './PortfolioConstraintEvaluator';
import { generateTradeOffOptions, rankTradeOffOptions } from './TradeOffGenerator';

export interface HorizonConstraintParams {
  requested_weeks: number;
  existing_content_count: number;
  expected_posts_per_week: number;
  team_posts_per_week_capacity?: number;
  total_budget?: number;
  cost_per_week?: number;
  baseline_status?: 'underdeveloped' | 'aligned' | 'strong';
  campaign_type_weights?: Record<string, number>;
  lead_heavy_minimum_weeks?: number;
  /** Portfolio-level params (optional) */
  campaignId?: string;
  companyId?: string;
  startDate?: string;
  endDate?: string;
  requestedPostsPerWeek?: number;
  /** Available production capacity (for trade-off generation when capacity limits) */
  availableCapacity?: number;
  /** Campaign priority for trade-off ranking (LOW | NORMAL | HIGH | CRITICAL) */
  campaignPriorityLevel?: string;
}

const LEAD_HEAVY_TYPES = ['lead_generation', 'lead_nurturing', 'conversion'];
const DEFAULT_EXPECTED_POSTS_PER_WEEK = 5;

function evaluateInventoryConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { existing_content_count, expected_posts_per_week } = params;
  const weekly = expected_posts_per_week || DEFAULT_EXPECTED_POSTS_PER_WEEK;

  if (existing_content_count <= 0) {
    return {
      name: 'inventory',
      status: 'BLOCKING',
      max_weeks_allowed: 0,
      reasoning: 'No content inventory available. Create or import content before planning.',
    };
  }

  const max_weeks = Math.floor(existing_content_count / weekly);
  if (max_weeks <= 0) {
    return {
      name: 'inventory',
      status: 'BLOCKING',
      max_weeks_allowed: 0,
      reasoning: `Insufficient content: ${existing_content_count} items for ${weekly} posts/week.`,
    };
  }

  return {
    name: 'inventory',
    status: max_weeks >= params.requested_weeks ? 'PASS' : 'LIMITING',
    max_weeks_allowed: max_weeks,
    reasoning: `${existing_content_count} items support up to ${max_weeks} weeks at ${weekly} posts/week.`,
  };
}

function evaluateProductionCapacityConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { team_posts_per_week_capacity, expected_posts_per_week } = params;
  const weekly = expected_posts_per_week || DEFAULT_EXPECTED_POSTS_PER_WEEK;

  if (team_posts_per_week_capacity == null || team_posts_per_week_capacity <= 0) {
    return {
      name: 'production_capacity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No team capacity data; constraint skipped.',
    };
  }

  if (weekly <= 0) {
    return {
      name: 'production_capacity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No expected weekly output defined.',
    };
  }

  const isLimiting = team_posts_per_week_capacity < weekly;
  const max_weeks = isLimiting
    ? Math.floor(team_posts_per_week_capacity / weekly)
    : 999;

  return {
    name: 'production_capacity',
    status: isLimiting ? 'LIMITING' : 'PASS',
    max_weeks_allowed: max_weeks,
    reasoning: isLimiting
      ? `Team capacity ${team_posts_per_week_capacity} posts/week below required ${weekly}.`
      : 'Production capacity sufficient for planned output.',
  };
}

function evaluateBudgetConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { total_budget, cost_per_week, requested_weeks } = params;

  if (total_budget == null || total_budget <= 0 || cost_per_week == null || cost_per_week <= 0) {
    return {
      name: 'budget',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No budget or cost data; constraint skipped.',
    };
  }

  const max_weeks = Math.floor(total_budget / cost_per_week);
  const exceedsBudget = cost_per_week * requested_weeks > total_budget;

  return {
    name: 'budget',
    status: exceedsBudget ? 'LIMITING' : 'PASS',
    max_weeks_allowed: max_weeks,
    reasoning: exceedsBudget
      ? `Budget ${total_budget} allows ~${max_weeks} weeks at ${cost_per_week}/week.`
      : 'Budget sufficient for requested duration.',
  };
}

function evaluateBaselineIntensityConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { baseline_status } = params;

  if (!baseline_status || baseline_status === 'aligned' || baseline_status === 'strong') {
    return {
      name: 'baseline_intensity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'Baseline does not cap duration.',
    };
  }

  // Underdeveloped baseline: force minimum 2-week activation ramp.
  // Does not cap max duration — only affects minimum viable. For evaluation we PASS
  // since we're evaluating ceiling, not floor. Conflict handling is in negotiation.
  return {
    name: 'baseline_intensity',
    status: 'PASS',
    max_weeks_allowed: 999,
    reasoning: 'Underdeveloped baseline suggests minimum 2-week ramp; no duration cap.',
  };
}

function evaluateCampaignTypeIntensityConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { campaign_type_weights, requested_weeks, lead_heavy_minimum_weeks = 3 } = params;

  if (!campaign_type_weights || typeof campaign_type_weights !== 'object') {
    return {
      name: 'campaign_type_intensity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No campaign type weights; constraint skipped.',
    };
  }

  const leadWeight = LEAD_HEAVY_TYPES.reduce(
    (sum, t) => sum + (campaign_type_weights[t] ?? 0),
    0
  );
  const isLeadHeavy = leadWeight >= 50;

  if (!isLeadHeavy) {
    return {
      name: 'campaign_type_intensity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'Campaign is not lead-heavy; no minimum duration.',
    };
  }

  if (requested_weeks >= lead_heavy_minimum_weeks) {
    return {
      name: 'campaign_type_intensity',
      status: 'PASS',
      max_weeks_allowed: 999,
      min_weeks_required: lead_heavy_minimum_weeks,
      reasoning: `Lead-heavy campaign meets minimum ${lead_heavy_minimum_weeks} weeks.`,
    };
  }

  return {
    name: 'campaign_type_intensity',
    status: 'LIMITING',
    max_weeks_allowed: 999,
    min_weeks_required: lead_heavy_minimum_weeks,
    reasoning: `Lead-heavy campaigns require at least ${lead_heavy_minimum_weeks} weeks for nurture cycle.`,
  };
}

export async function evaluateCampaignDuration(
  params: HorizonConstraintParams
): Promise<DurationEvaluationResult> {
  const evaluators = [
    evaluateInventoryConstraint,
    evaluateProductionCapacityConstraint,
    evaluateBudgetConstraint,
    evaluateBaselineIntensityConstraint,
    evaluateCampaignTypeIntensityConstraint,
  ];

  let results: ConstraintResult[] = evaluators.map((fn) => fn(params));
  let portfolioSuggestedTradeOffs: TradeOffOption[] | undefined;

  const portfolioParams =
    params.campaignId &&
    params.companyId &&
    params.startDate &&
    params.endDate &&
    params.requestedPostsPerWeek != null;

  if (portfolioParams) {
    const portfolioOutput = await evaluatePortfolioConstraints({
      campaignId: params.campaignId!,
      companyId: params.companyId!,
      requestedDurationWeeks: params.requested_weeks,
      requestedPostsPerWeek: params.requestedPostsPerWeek!,
      startDate: params.startDate!,
      endDate: params.endDate!,
      existing_content_count: params.existing_content_count,
      priorityLevel: params.campaignPriorityLevel,
    });
    results = [...results, ...portfolioOutput.constraints];
    portfolioSuggestedTradeOffs = portfolioOutput.suggestedTradeOffs;
  }

  const blocking = results.filter((r) => r.status === 'BLOCKING');
  const limiting = results.filter((r) => r.status === 'LIMITING');
  const passOrLimiting = results.filter((r) => r.status === 'PASS' || r.status === 'LIMITING');

  if (blocking.length > 0) {
    const baseTradeOffs = generateTradeOffOptions({
      requestedDurationWeeks: params.requested_weeks,
      requestedPostsPerWeek: params.requestedPostsPerWeek ?? params.expected_posts_per_week,
      totalInventory: params.existing_content_count,
      maxWeeksAllowed: 0,
      limitingConstraints: limiting,
      availableCapacity: params.availableCapacity ?? params.team_posts_per_week_capacity,
    });
    const tradeOffOptions = rankTradeOffOptions(
      [...baseTradeOffs, ...(portfolioSuggestedTradeOffs ?? [])],
      params.campaignPriorityLevel
    );
    return {
      requested_weeks: params.requested_weeks,
      max_weeks_allowed: 0,
      limiting_constraints: limiting,
      blocking_constraints: blocking,
      status: 'REJECTED',
      tradeOffOptions: tradeOffOptions.length > 0 ? tradeOffOptions : undefined,
    };
  }

  const max_weeks_allowed = passOrLimiting.length > 0
    ? Math.min(...passOrLimiting.map((r) => r.max_weeks_allowed))
    : params.requested_weeks;

  const minRequired = Math.max(0, ...results.map((r) => r.min_weeks_required ?? 0));

  const baseTradeOffOptions = generateTradeOffOptions({
    requestedDurationWeeks: params.requested_weeks,
    requestedPostsPerWeek: params.requestedPostsPerWeek ?? params.expected_posts_per_week,
    totalInventory: params.existing_content_count,
    maxWeeksAllowed: max_weeks_allowed,
    minWeeksRequired: minRequired > 0 ? minRequired : undefined,
    limitingConstraints: limiting,
    availableCapacity: params.availableCapacity ?? params.team_posts_per_week_capacity,
  });

  const tradeOffOptions = rankTradeOffOptions(
    [...baseTradeOffOptions, ...(portfolioSuggestedTradeOffs ?? [])],
    params.campaignPriorityLevel
  );

  if (minRequired > 0 && params.requested_weeks < minRequired) {
    const status =
      max_weeks_allowed !== undefined && max_weeks_allowed <= 0 ? 'REJECTED' : 'NEGOTIATE';
    return {
      requested_weeks: params.requested_weeks,
      max_weeks_allowed,
      min_weeks_required: minRequired,
      limiting_constraints: limiting,
      blocking_constraints: [],
      status,
      tradeOffOptions: tradeOffOptions.length > 0 ? tradeOffOptions : undefined,
    };
  }

  if (params.requested_weeks > max_weeks_allowed) {
    const minRequiredForMax = Math.max(0, ...results.map((r) => r.min_weeks_required ?? 0));
    const status =
      max_weeks_allowed !== undefined && max_weeks_allowed <= 0 ? 'REJECTED' : 'NEGOTIATE';
    return {
      requested_weeks: params.requested_weeks,
      max_weeks_allowed,
      min_weeks_required: minRequiredForMax > 0 ? minRequiredForMax : undefined,
      limiting_constraints: limiting,
      blocking_constraints: [],
      status,
      tradeOffOptions: tradeOffOptions.length > 0 ? tradeOffOptions : undefined,
    };
  }

  return {
    requested_weeks: params.requested_weeks,
    max_weeks_allowed,
    limiting_constraints: limiting,
    blocking_constraints: [],
    status: 'APPROVED',
  };
}
