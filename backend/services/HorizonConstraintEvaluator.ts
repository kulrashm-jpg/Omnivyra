/**
 * Modular Campaign Duration Constraint Framework — Horizon Evaluator.
 * Evaluates requested duration against all constraints.
 * No negotiation logic — only evaluation.
 * Constraint-agnostic: max_weeks = min of all PASS/LIMITING ceilings.
 */

import type { ConstraintResult, DurationEvaluationResult, TradeOffOption } from '../types/CampaignDuration';
import { GOVERNANCE_EVALUATION_ORDER } from '../governance/GovernanceContract';
import { recordGovernanceEvent } from './GovernanceEventService';
import { evaluatePortfolioConstraints } from './PortfolioConstraintEvaluator';
import { generateTradeOffOptions, rankTradeOffOptions } from './TradeOffGenerator';
import { supabase } from '../db/supabaseClient';

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
  /** Content-type capacity: available count per type (e.g. { video: 5, post: 10 }) */
  contentAssetsByType?: Record<string, number>;
  /** Required weekly mix per type (e.g. { video: 2, post: 3 }) — when set, enables CONTENT_TYPE_CAPACITY check */
  expectedContentMix?: Record<string, number>;
  /** Planned asset IDs for content collision check (from content_assets or blueprint) */
  plannedAssetIds?: string[];
  /** Stage 23: Optional evaluation context for immutable decision snapshot (audit only) */
  execution_status?: string;
  blueprint_status?: string;
  duration_locked?: boolean;
  /** Stage 24: Suppress event emission during replay. Stage 26: Optional policy version for evaluation. */
  evaluationOptions?: { suppressEvents?: boolean; policyVersion?: string };
  /**
   * When true and inventory is empty: allow planning with placeholders (e.g. new campaign from opportunity).
   * Inventory constraint returns PASS with max_weeks from other constraints instead of BLOCKING.
   */
  allowPlaceholderPlanning?: boolean;
}

const LEAD_HEAVY_TYPES = ['lead_generation', 'lead_nurturing', 'conversion'];
const DEFAULT_EXPECTED_POSTS_PER_WEEK = 5;

function evaluateInventoryConstraint(params: HorizonConstraintParams): ConstraintResult {
  const { existing_content_count, expected_posts_per_week, allowPlaceholderPlanning } = params;
  const weekly = expected_posts_per_week || DEFAULT_EXPECTED_POSTS_PER_WEEK;

  if (existing_content_count <= 0) {
    if (allowPlaceholderPlanning) {
      return {
        name: 'inventory',
        status: 'PASS',
        max_weeks_allowed: 999,
        reasoning:
          'New campaign with no content: planning allowed with placeholders. Duration will be limited by production capacity, budget, or other constraints.',
      };
    }
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

/**
 * Content-type capacity: compare available assets by type vs required weekly mix.
 * Runs only when expectedContentMix is set (from expected_content_mix or campaign-type inference).
 */
function evaluateContentTypeCapacityConstraint(params: HorizonConstraintParams): ConstraintResult {
  const {
    contentAssetsByType = {},
    expectedContentMix = {},
    requested_weeks,
    expected_posts_per_week,
  } = params;

  const mixEntries = Object.entries(expectedContentMix).filter(([, v]) => v != null && v > 0);
  if (mixEntries.length === 0) {
    return {
      name: 'content_type_capacity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No content-type mix defined; constraint skipped.',
    };
  }

  const weekly = expected_posts_per_week || DEFAULT_EXPECTED_POSTS_PER_WEEK;
  let minMaxWeeks = 999;
  let limitingType: string | null = null;

  for (const [type, requiredPerWeek] of mixEntries) {
    const available = contentAssetsByType[type] ?? 0;
    if (requiredPerWeek <= 0) continue;

    if (available <= 0) {
      return {
        name: 'content_type_capacity',
        status: 'BLOCKING',
        max_weeks_allowed: 0,
        missing_type: type,
        reasoning: `Insufficient ${type} assets for requested duration. Required ${requiredPerWeek}/week.`,
      };
    }

    const maxWeeksForType = Math.floor(available / requiredPerWeek);
    if (maxWeeksForType < minMaxWeeks) {
      minMaxWeeks = maxWeeksForType;
      limitingType = type;
    }
  }

  if (minMaxWeeks >= requested_weeks) {
    return {
      name: 'content_type_capacity',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'Content-type mix sufficient for requested duration.',
    };
  }

  const typeLabel = limitingType ?? 'content';
  return {
    name: 'content_type_capacity',
    status: 'LIMITING',
    max_weeks_allowed: minMaxWeeks,
    missing_type: limitingType ?? undefined,
    reasoning: `Insufficient ${typeLabel} assets for requested duration. Adjust weekly mix or add more ${typeLabel} content.`,
  };
}

export interface ContentCollisionParams {
  campaignId: string;
  companyId: string;
  requestedDurationWeeks: number;
  plannedAssetIds: string[];
  startDate: string;
  endDate: string;
}

/**
 * Content collision: detect overlapping campaigns sharing planned content assets.
 * Runs when campaignId, companyId, plannedAssetIds, startDate, endDate are set.
 */
export async function evaluateContentCollision(params: ContentCollisionParams): Promise<ConstraintResult> {
  const {
    campaignId,
    companyId,
    plannedAssetIds,
    startDate,
    endDate,
  } = params;

  if (!plannedAssetIds?.length) {
    return {
      name: 'content_collision',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No planned assets defined; content collision check skipped.',
    };
  }

  if (!startDate || !endDate) {
    return {
      name: 'content_collision',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No date range; content collision check skipped.',
    };
  }

  const newStart = new Date(startDate).getTime();
  const newEnd = new Date(endDate).getTime();

  // 1. Get company campaign IDs via campaign_versions (no campaigns.company_id)
  const { data: cvRows } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);
  const companyCampaignIds = Array.from(new Set((cvRows ?? []).map((r: any) => r.campaign_id).filter(Boolean)));
  const otherCampaignIds = companyCampaignIds.filter((id) => id !== campaignId);
  if (otherCampaignIds.length === 0) {
    return {
      name: 'content_collision',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No other company campaigns; no content collision risk.',
    };
  }

  // 2. Fetch campaigns (start_date, end_date, execution_status)
  const { data: campaignRows } = await supabase
    .from('campaigns')
    .select('id, start_date, end_date, execution_status')
    .in('id', otherCampaignIds);

  const overlapping: Array<{ id: string; end_date?: string }> = [];
  for (const row of campaignRows ?? []) {
    const status = String(row.execution_status ?? 'ACTIVE').toUpperCase();
    if (status === 'PREEMPTED') continue;
    const aStart = row.start_date ? new Date(row.start_date).getTime() : 0;
    const aEnd = row.end_date ? new Date(row.end_date).getTime() : 0;
    if (aStart <= newEnd && aEnd >= newStart) {
      overlapping.push({ id: row.id, end_date: row.end_date });
    }
  }

  if (overlapping.length === 0) {
    return {
      name: 'content_collision',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No overlapping campaigns; no content collision risk.',
    };
  }

  const overlappingIds = overlapping.map((o) => o.id);

  // 3. Load planned asset IDs for overlapping campaigns from content_assets
  const { data: assetRows } = await supabase
    .from('content_assets')
    .select('asset_id, campaign_id')
    .in('campaign_id', overlappingIds);

  const otherAssetIds = new Set<string>();
  for (const r of assetRows ?? []) {
    if (r.asset_id) otherAssetIds.add(String(r.asset_id));
  }

  const collidingAssetIds = plannedAssetIds.filter((id) => otherAssetIds.has(String(id)));
  const collidingCampaignIds = overlappingIds;

  if (collidingAssetIds.length === 0) {
    return {
      name: 'content_collision',
      status: 'PASS',
      max_weeks_allowed: 999,
      reasoning: 'No shared content assets with overlapping campaigns.',
    };
  }

  const collisionRatio = collidingAssetIds.length / plannedAssetIds.length;
  const severity: 'LIMITING' | 'BLOCKING' = collisionRatio > 0.5 ? 'BLOCKING' : 'LIMITING';
  const maxWeeks = severity === 'BLOCKING' ? 0 : Math.max(0, params.requestedDurationWeeks - 1);

  const latestEnd = overlapping
    .map((o) => (o.end_date ? new Date(o.end_date).getTime() : 0))
    .filter(Boolean);
  const dayAfterLatest = latestEnd.length > 0
    ? new Date(Math.max(...latestEnd) + 86400000).toISOString().slice(0, 10)
    : undefined;

  const result: ConstraintResult & { _suggestedTradeOffs?: TradeOffOption[] } = {
    name: 'content_collision',
    status: severity,
    max_weeks_allowed: maxWeeks,
    reasoning: 'Content assets are already allocated to overlapping campaigns.',
    collidingCampaignIds,
    collidingAssetIds,
  };

  if (dayAfterLatest) {
    (result as any)._suggestedTradeOffs = [
      { type: 'SHIFT_START_DATE', newStartDate: dayAfterLatest, reasoning: 'Start after overlapping campaigns conclude to avoid content collision.' },
    ];
  }

  return result;
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
  const suppressEvents = params.evaluationOptions?.suppressEvents === true;
  const executionTrace: string[] = [];
  executionTrace.push("INVENTORY");
  executionTrace.push("CONTENT_TYPE_CAPACITY");
  executionTrace.push("CONTENT_COLLISION");
  executionTrace.push("PRODUCTION_CAPACITY");
  executionTrace.push("BUDGET");
  executionTrace.push("BASELINE");
  executionTrace.push("CAMPAIGN_TYPE_MINIMUM");

  const evaluators = [
    evaluateInventoryConstraint,
    evaluateContentTypeCapacityConstraint,
    evaluateProductionCapacityConstraint,
    evaluateBudgetConstraint,
    evaluateBaselineIntensityConstraint,
    evaluateCampaignTypeIntensityConstraint,
  ];

  let results: ConstraintResult[] = evaluators.map((fn) => fn(params));
  let portfolioSuggestedTradeOffs: TradeOffOption[] | undefined;

  const contentCollisionParams =
    params.campaignId &&
    params.companyId &&
    params.plannedAssetIds &&
    params.plannedAssetIds.length > 0 &&
    params.startDate &&
    params.endDate;

  let contentCollisionTradeOffs: TradeOffOption[] = [];
  if (contentCollisionParams) {
    const collisionResult = await evaluateContentCollision({
      campaignId: params.campaignId!,
      companyId: params.companyId!,
      requestedDurationWeeks: params.requested_weeks,
      plannedAssetIds: params.plannedAssetIds!,
      startDate: params.startDate!,
      endDate: params.endDate!,
    });
    const cc = collisionResult as ConstraintResult & { _suggestedTradeOffs?: TradeOffOption[] };
    if (cc._suggestedTradeOffs?.length) {
      contentCollisionTradeOffs = cc._suggestedTradeOffs;
    }
    const { _suggestedTradeOffs, ...cleanResult } = cc;
    results = [...results, cleanResult];
  }

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
  executionTrace.push("PORTFOLIO");

  const blocking = results.filter((r) => r.status === 'BLOCKING');
  const limiting = results.filter((r) => r.status === 'LIMITING');
  const passOrLimiting = results.filter((r) => r.status === 'PASS' || r.status === 'LIMITING');

  const buildEvalContext = (blockCnt: number, limitCnt: number) => {
    const ctx: Record<string, unknown> = {
      constraint_count: blockCnt + limitCnt,
      requested_weeks: params.requested_weeks,
    };
    if (params.execution_status != null) ctx.execution_status = params.execution_status;
    if (params.blueprint_status != null) ctx.blueprint_status = params.blueprint_status;
    if (params.duration_locked != null) ctx.duration_locked = params.duration_locked;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  };

  if (blocking.length > 0) {
    executionTrace.push("TRADE_OFF_GENERATION");
    console.log('GOV_EVENT: DURATION_REJECTED', JSON.stringify({
      campaignId: params.campaignId,
      companyId: params.companyId,
      requested_weeks: params.requested_weeks,
      max_weeks_allowed: 0,
    }));
    const baseTradeOffs = generateTradeOffOptions({
      requestedDurationWeeks: params.requested_weeks,
      requestedPostsPerWeek: params.requestedPostsPerWeek ?? params.expected_posts_per_week,
      totalInventory: params.existing_content_count,
      maxWeeksAllowed: 0,
      limitingConstraints: limiting,
      availableCapacity: params.availableCapacity ?? params.team_posts_per_week_capacity,
    });
    const tradeOffOptions = rankTradeOffOptions(
      [...baseTradeOffs, ...contentCollisionTradeOffs, ...(portfolioSuggestedTradeOffs ?? [])],
      params.campaignPriorityLevel
    );
    executionTrace.push("FINAL_STATUS");
    if (process.env.NODE_ENV !== "production") {
      const contract = GOVERNANCE_EVALUATION_ORDER;
      if (JSON.stringify(executionTrace) !== JSON.stringify(contract)) {
        throw new Error("Governance evaluation order violated.");
      }
    }
    if (params.companyId && params.campaignId && !suppressEvents) {
      const minReq = Math.max(0, ...results.map((r) => r.min_weeks_required ?? 0));
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: params.campaignId,
        eventType: 'DURATION_REJECTED',
        eventStatus: 'REJECTED',
        metadata: {
          requested_weeks: params.requested_weeks,
          max_weeks_allowed: 0,
          min_weeks_required: minReq > 0 ? minReq : undefined,
          limiting_constraints_count: limiting.length,
          blocking_constraints_count: blocking.length,
        },
        evaluationContext: buildEvalContext(blocking.length, limiting.length),
      });
      const contentTypeConstraint = [...blocking, ...limiting].find((r) => r.name === 'content_type_capacity');
      if (contentTypeConstraint) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_CAPACITY_LIMITED',
          eventStatus: 'REJECTED',
          metadata: {
            missing_type: (contentTypeConstraint as any).missing_type,
            max_weeks_allowed: contentTypeConstraint.max_weeks_allowed,
          },
          evaluationContext: buildEvalContext(blocking.length, limiting.length),
        });
      }
      const contentCollisionConstraint = [...blocking, ...limiting].find((r) => r.name === 'content_collision');
      if (contentCollisionConstraint && (contentCollisionConstraint.collidingCampaignIds?.length || contentCollisionConstraint.collidingAssetIds?.length)) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_COLLISION_DETECTED',
          eventStatus: 'REJECTED',
          metadata: {
            collidingCampaignIds: contentCollisionConstraint.collidingCampaignIds ?? [],
            collidingAssetIds: contentCollisionConstraint.collidingAssetIds ?? [],
            severity: contentCollisionConstraint.status,
          },
          evaluationContext: buildEvalContext(blocking.length, limiting.length),
        });
      }
    }
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

  executionTrace.push("TRADE_OFF_GENERATION");
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
    [...baseTradeOffOptions, ...contentCollisionTradeOffs, ...(portfolioSuggestedTradeOffs ?? [])],
    params.campaignPriorityLevel
  );

  if (minRequired > 0 && params.requested_weeks < minRequired) {
    const status =
      max_weeks_allowed !== undefined && max_weeks_allowed <= 0 ? 'REJECTED' : 'NEGOTIATE';
    console.log(status === 'NEGOTIATE' ? 'GOV_EVENT: DURATION_NEGOTIATE' : 'GOV_EVENT: DURATION_REJECTED', JSON.stringify({
      campaignId: params.campaignId,
      companyId: params.companyId,
      requested_weeks: params.requested_weeks,
      max_weeks_allowed,
      status,
    }));
    executionTrace.push("FINAL_STATUS");
    if (process.env.NODE_ENV !== "production") {
      const contract = GOVERNANCE_EVALUATION_ORDER;
      if (JSON.stringify(executionTrace) !== JSON.stringify(contract)) {
        throw new Error("Governance evaluation order violated.");
      }
    }
    if (params.companyId && params.campaignId && !suppressEvents) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: params.campaignId,
        eventType: 'DURATION_NEGOTIATE',
        eventStatus: status,
        metadata: {
          requested_weeks: params.requested_weeks,
          max_weeks_allowed,
          min_weeks_required: minRequired,
          limiting_constraints_count: limiting.length,
          blocking_constraints_count: 0,
        },
        evaluationContext: buildEvalContext(0, limiting.length),
      });
      const contentTypeConstraint = limiting.find((r) => r.name === 'content_type_capacity');
      if (contentTypeConstraint) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_CAPACITY_LIMITED',
          eventStatus: status,
          metadata: {
            missing_type: (contentTypeConstraint as any).missing_type,
            max_weeks_allowed: contentTypeConstraint.max_weeks_allowed,
          },
          evaluationContext: buildEvalContext(0, limiting.length),
        });
      }
      const contentCollisionConstraint = limiting.find((r) => r.name === 'content_collision');
      if (contentCollisionConstraint && (contentCollisionConstraint.collidingCampaignIds?.length || contentCollisionConstraint.collidingAssetIds?.length)) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_COLLISION_DETECTED',
          eventStatus: status,
          metadata: {
            collidingCampaignIds: contentCollisionConstraint.collidingCampaignIds ?? [],
            collidingAssetIds: contentCollisionConstraint.collidingAssetIds ?? [],
            severity: contentCollisionConstraint.status,
          },
          evaluationContext: buildEvalContext(0, limiting.length),
        });
      }
    }
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
    console.log(status === 'NEGOTIATE' ? 'GOV_EVENT: DURATION_NEGOTIATE' : 'GOV_EVENT: DURATION_REJECTED', JSON.stringify({
      campaignId: params.campaignId,
      companyId: params.companyId,
      requested_weeks: params.requested_weeks,
      max_weeks_allowed,
      status,
    }));
    executionTrace.push("FINAL_STATUS");
    if (process.env.NODE_ENV !== "production") {
      const contract = GOVERNANCE_EVALUATION_ORDER;
      if (JSON.stringify(executionTrace) !== JSON.stringify(contract)) {
        throw new Error("Governance evaluation order violated.");
      }
    }
    if (params.companyId && params.campaignId && !suppressEvents) {
      recordGovernanceEvent({
        companyId: params.companyId,
        campaignId: params.campaignId,
        eventType: 'DURATION_NEGOTIATE',
        eventStatus: status,
        metadata: {
          requested_weeks: params.requested_weeks,
          max_weeks_allowed,
          min_weeks_required: minRequiredForMax > 0 ? minRequiredForMax : undefined,
          limiting_constraints_count: limiting.length,
          blocking_constraints_count: 0,
        },
        evaluationContext: buildEvalContext(0, limiting.length),
      });
      const contentTypeConstraint = limiting.find((r) => r.name === 'content_type_capacity');
      if (contentTypeConstraint) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_CAPACITY_LIMITED',
          eventStatus: status,
          metadata: {
            missing_type: (contentTypeConstraint as any).missing_type,
            max_weeks_allowed: contentTypeConstraint.max_weeks_allowed,
          },
          evaluationContext: buildEvalContext(0, limiting.length),
        });
      }
      const contentCollisionConstraint = limiting.find((r) => r.name === 'content_collision');
      if (contentCollisionConstraint && (contentCollisionConstraint.collidingCampaignIds?.length || contentCollisionConstraint.collidingAssetIds?.length)) {
        recordGovernanceEvent({
          companyId: params.companyId,
          campaignId: params.campaignId,
          eventType: 'CONTENT_COLLISION_DETECTED',
          eventStatus: status,
          metadata: {
            collidingCampaignIds: contentCollisionConstraint.collidingCampaignIds ?? [],
            collidingAssetIds: contentCollisionConstraint.collidingAssetIds ?? [],
            severity: contentCollisionConstraint.status,
          },
          evaluationContext: buildEvalContext(0, limiting.length),
        });
      }
    }
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

  executionTrace.push("FINAL_STATUS");
  if (process.env.NODE_ENV !== "production") {
    const contract = GOVERNANCE_EVALUATION_ORDER;
    if (JSON.stringify(executionTrace) !== JSON.stringify(contract)) {
      throw new Error("Governance evaluation order violated.");
    }
  }
  if (params.companyId && params.campaignId && !suppressEvents) {
    recordGovernanceEvent({
      companyId: params.companyId,
      campaignId: params.campaignId,
      eventType: 'DURATION_APPROVED',
      eventStatus: 'APPROVED',
      metadata: {
        requested_weeks: params.requested_weeks,
        max_weeks_allowed,
        limiting_constraints_count: limiting.length,
        blocking_constraints_count: 0,
      },
      evaluationContext: buildEvalContext(0, limiting.length),
    });
  }
  return {
    requested_weeks: params.requested_weeks,
    max_weeks_allowed,
    limiting_constraints: limiting,
    blocking_constraints: [],
    status: 'APPROVED',
  };
}
