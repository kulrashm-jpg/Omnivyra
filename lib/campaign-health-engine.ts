/**
 * Campaign Health Engine — reusable, campaign-scoped health aggregation.
 * No UI logic. Powers Campaign Radar and (future) Company Super Radar.
 */

import type { Activity, ActivityStage } from '../components/activity-board/types';
import { ACTIVITY_STAGES } from '../components/activity-board/types';
import { isOverdue, isBlocked, isNearDue } from '../components/activity-board/board-indicators';

// ---------------------------------------------------------------------------
// Types (engine output only)
// ---------------------------------------------------------------------------

export interface StageHealthSummaryItem {
  stage: ActivityStage;
  count: number;
  overdueCount: number;
  blockedCount: number;
  hasIssues: boolean;
}

export type AttentionReason = 'overdue' | 'waiting_approval' | 'unassigned' | 'blocked';

export interface AttentionItem {
  activityId: string;
  activity: Activity;
  reason: AttentionReason;
  priority: number;
}

export interface CampaignHealth {
  totalActivities: number;
  overdueCount: number;
  blockedCount: number;
  pendingApprovalCount: number;
  approvedCount: number;
  unassignedCount: number;
  scheduledCount: number;
  stageHealthSummary: StageHealthSummaryItem[];
  attentionItems: AttentionItem[];
}

/** Rule-based recommended manager action (suggestion only; no automation). */
export interface RecommendedAction {
  activityId: string;
  activityTitle: string;
  actionLabel: string;
  reason: string;
}

/** Executive-friendly weekly summary (3–4 sentences, human-readable, rule-based). */
export interface WeeklySummaryNarrative {
  /** Data-supported positive signal; null when none applies. Shown first when present. */
  positiveSignal: string | null;
  overallHealth: string;
  whatIsWorking: string;
  needsAttention: string;
  recommendedFocus: string;
}

// ---------------------------------------------------------------------------
// Signal priority (attention feed order)
// ---------------------------------------------------------------------------

export const ATTENTION_PRIORITY: Record<AttentionReason, number> = {
  overdue: 100,
  blocked: 90,
  waiting_approval: 85,
  unassigned: 70,
};

function isUnassigned(a: Activity): boolean {
  return !a.owner_id && !a.owner_name;
}

// ---------------------------------------------------------------------------
// Pure aggregation (no I/O, no UI)
// ---------------------------------------------------------------------------

export interface ComputeCampaignHealthOptions {
  now?: number;
}

/**
 * Computes campaign-level health from a list of activities (for one campaign).
 * No UI logic. Reusable by any consumer (UI, API, future company aggregation).
 */
export function computeCampaignHealth(
  activities: Activity[],
  options: ComputeCampaignHealthOptions = {}
): CampaignHealth {
  const now = options.now ?? Date.now();

  let overdueCount = 0;
  let blockedCount = 0;
  let pendingApprovalCount = 0;
  let approvedCount = 0;
  let unassignedCount = 0;
  let scheduledCount = 0;

  const byStage: Record<ActivityStage, { count: number; overdue: number; blocked: number }> = {
    PLAN: { count: 0, overdue: 0, blocked: 0 },
    CREATE: { count: 0, overdue: 0, blocked: 0 },
    REPURPOSE: { count: 0, overdue: 0, blocked: 0 },
    SCHEDULE: { count: 0, overdue: 0, blocked: 0 },
    SHARE: { count: 0, overdue: 0, blocked: 0 },
  };

  const attentionCandidates: AttentionItem[] = [];

  for (const a of activities) {
    const overdue = isOverdue(a, now);
    const blocked = isBlocked(a);
    const pending = a.approval_status === 'pending';
    const approved = a.approval_status === 'approved';
    const unassigned = isUnassigned(a);

    if (overdue) overdueCount++;
    if (blocked) blockedCount++;
    if (pending) pendingApprovalCount++;
    if (approved) approvedCount++;
    if (unassigned) unassignedCount++;
    if (a.stage === 'SCHEDULE') scheduledCount++;

    const row = byStage[a.stage];
    if (row) {
      row.count++;
      if (overdue) row.overdue++;
      if (blocked) row.blocked++;
    }

    let reason: AttentionReason | null = null;
    if (overdue) reason = 'overdue';
    else if (blocked) reason = pending ? 'waiting_approval' : 'blocked';
    else if (unassigned) reason = 'unassigned';
    if (reason != null) {
      attentionCandidates.push({
        activityId: a.id,
        activity: a,
        reason,
        priority: ATTENTION_PRIORITY[reason],
      });
    }
  }

  const stageHealthSummary: StageHealthSummaryItem[] = ACTIVITY_STAGES.map((stage) => {
    const row = byStage[stage];
    return {
      stage,
      count: row.count,
      overdueCount: row.overdue,
      blockedCount: row.blocked,
      hasIssues: row.overdue > 0 || row.blocked > 0,
    };
  });

  attentionCandidates.sort((x, y) => {
    const p = y.priority - x.priority;
    if (p !== 0) return p;
    return (x.activity.title || '').localeCompare(y.activity.title || '');
  });

  const seen = new Set<string>();
  const attentionItems: AttentionItem[] = [];
  for (const item of attentionCandidates) {
    if (seen.has(item.activityId)) continue;
    seen.add(item.activityId);
    attentionItems.push(item);
  }

  return {
    totalActivities: activities.length,
    overdueCount,
    blockedCount,
    pendingApprovalCount,
    approvedCount,
    unassignedCount,
    scheduledCount,
    stageHealthSummary,
    attentionItems,
  };
}

// ---------------------------------------------------------------------------
// Recommended Actions (rule-based prioritization; top N for radar)
// ---------------------------------------------------------------------------

const RECOMMENDATION_PRIORITY_ORDER: AttentionReason[] = [
  'overdue',
  'blocked',
  'waiting_approval',
  'unassigned',
];

/**
 * Returns top N recommended manager actions (rule-based, not ML).
 * Priority: 1. Overdue, 2. Blocked, 3. Waiting approvals, 4. Unassigned, 5. Approved but not moved.
 * Suggestions only; no workflow automation.
 */
export function getRecommendedActions(
  health: CampaignHealth,
  activities: Activity[],
  limit: number = 3
): RecommendedAction[] {
  const seen = new Set<string>();
  const result: RecommendedAction[] = [];

  const actionLabels: Record<AttentionReason, string> = {
    overdue: 'Address overdue',
    blocked: 'Unblock',
    waiting_approval: 'Review',
    unassigned: 'Assign',
  };

  const reasonLabels: Record<AttentionReason, string> = {
    overdue: 'Overdue',
    blocked: 'Blocked - changes requested',
    waiting_approval: 'Waiting approval',
    unassigned: 'Unassigned',
  };

  for (const reason of RECOMMENDATION_PRIORITY_ORDER) {
    for (const item of health.attentionItems) {
      if (item.reason !== reason || seen.has(item.activityId) || result.length >= limit) continue;
      seen.add(item.activityId);
      result.push({
        activityId: item.activityId,
        activityTitle: item.activity.title || 'Untitled',
        actionLabel: actionLabels[item.reason],
        reason: reasonLabels[item.reason],
      });
    }
    if (result.length >= limit) break;
  }

  if (result.length < limit) {
    const lastStage = ACTIVITY_STAGES[ACTIVITY_STAGES.length - 1];
    for (const a of activities) {
      if (result.length >= limit) break;
      if (seen.has(a.id)) continue;
      if (a.approval_status !== 'approved' || a.stage === lastStage) continue;
      seen.add(a.id);
      result.push({
        activityId: a.id,
        activityTitle: a.title || 'Untitled',
        actionLabel: 'Move to next stage',
        reason: 'Approved but not moved',
      });
    }
  }

  return result.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Weekly Summary Narrative (GUIDED tone + balanced positive reinforcement)
// ---------------------------------------------------------------------------
// Order: 1. Positive signal (if data-supported), 2. Key insight or risk, 3. Soft recommendation.
// Tone: professional only. Positive must be data-supported; no exaggerated praise.
// Allowed: consider, recommended focus, opportunity. Avoid: must, urgent, casual praise, emotional/motivational wording.

/**
 * Positivity detection: only returns a phrase when data clearly supports it.
 * Priority order; first match wins. No positive signal → null (skip section safely).
 */
function getDataSupportedPositiveSignal(
  health: CampaignHealth,
  stageHealthSummary: StageHealthSummaryItem[]
): string | null {
  const { totalActivities, overdueCount, blockedCount, approvedCount, scheduledCount } = health;
  const createStage = stageHealthSummary.find((s) => s.stage === 'CREATE');
  const scheduleStage = stageHealthSummary.find((s) => s.stage === 'SCHEDULE');

  if (totalActivities === 0) return null;

  if (overdueCount === 0 && blockedCount === 0 && totalActivities >= 1) {
    return 'Execution pace remains stable.';
  }
  if (createStage && createStage.count >= 1 && !createStage.hasIssues) {
    return 'Creation stage shows strong momentum.';
  }
  if (scheduleStage && scheduleStage.count >= 1 && !scheduleStage.hasIssues) {
    return 'Scheduling flow is healthy.';
  }
  if (approvedCount >= 1 && overdueCount === 0 && blockedCount === 0) {
    return 'Approvals are moving through.';
  }
  return null;
}

/**
 * Generates a short human-readable narrative from campaign health and activities.
 * Narrative order: positive signal (if valid) → key insight/risk → soft recommendation.
 * Update frequency: typically once daily; caller may cache by date.
 */
export function generateWeeklySummaryNarrative(
  health: CampaignHealth,
  activities: Activity[],
  options: ComputeCampaignHealthOptions = {}
): WeeklySummaryNarrative {
  const now = options.now ?? Date.now();
  const {
    totalActivities,
    overdueCount,
    blockedCount,
    pendingApprovalCount,
    unassignedCount,
    scheduledCount,
    stageHealthSummary,
  } = health;

  let nearDueCount = 0;
  for (const a of activities) {
    if (isNearDue(a, now) && !isOverdue(a, now)) nearDueCount++;
  }
  const bottleneckStages = stageHealthSummary.filter((s) => s.hasIssues || s.blockedCount > 0);
  const approvedCount = activities.filter((a) => a.approval_status === 'approved').length;

  const positiveSignal = getDataSupportedPositiveSignal(health, stageHealthSummary);

  // 1. Overall health statement (neutral; no urgency)
  let overallHealth: string;
  if (totalActivities === 0) {
    overallHealth = 'This campaign has no activities yet.';
  } else if (overdueCount > 0 || blockedCount > 0) {
    overallHealth = 'Campaign execution has some items past due or blocked.';
  } else if (pendingApprovalCount > 0 || unassignedCount > 0) {
    overallHealth = 'Campaign execution is largely on track, with a few items in review or unassigned.';
  } else {
    overallHealth = 'Campaign execution is on track.';
  }

  // 2. Key insight or risk (informative; data-supported)
  const workingParts: string[] = [];
  if (approvedCount > 0) workingParts.push(`${approvedCount} approved`);
  if (scheduledCount > 0) workingParts.push(`${scheduledCount} in schedule`);
  const whatIsWorking =
    workingParts.length > 0
      ? `Momentum is supported by ${workingParts.join(', ')}.`
      : 'Activities are moving through the pipeline.';

  const attentionParts: string[] = [];
  if (overdueCount > 0) attentionParts.push(`${overdueCount} past due`);
  if (pendingApprovalCount > 0) attentionParts.push(`${pendingApprovalCount} waiting approval`);
  if (blockedCount > 0) attentionParts.push(`${blockedCount} blocked`);
  if (unassignedCount > 0) attentionParts.push(`${unassignedCount} unassigned`);
  if (bottleneckStages.length > 0) attentionParts.push(`bottlenecks in ${bottleneckStages.length} stage(s)`);
  const needsAttention =
    attentionParts.length > 0
      ? `A few items may be slowing flow: ${attentionParts.join(', ')}.`
      : 'No particular slowdowns at the moment.';

  // 3. Soft recommendation only (consider / recommended focus / opportunity)
  let recommendedFocus: string;
  if (overdueCount > 0 || blockedCount > 0) {
    recommendedFocus =
      'Recommended focus: consider clearing past-due and blocked items when you can, then assigning any unassigned work.';
  } else if (unassignedCount > 0) {
    recommendedFocus =
      'Recommended focus: there is an opportunity to assign unassigned activities so the team can keep momentum.';
  } else if (pendingApprovalCount > 0) {
    recommendedFocus =
      'Recommended focus: consider reviewing pending approvals when convenient to keep the pipeline moving.';
  } else {
    recommendedFocus = 'Consider keeping an eye on upcoming due dates and stage movement.';
  }

  return {
    positiveSignal,
    overallHealth,
    whatIsWorking,
    needsAttention,
    recommendedFocus,
  };
}

// ---------------------------------------------------------------------------
// Campaign-scoped API (async; injectable data source)
// ---------------------------------------------------------------------------

export type FetchActivitiesForCampaign = (campaignId: string) => Promise<Activity[]>;

/**
 * Returns campaign health for a given campaign.
 * Pass fetchActivities to resolve activities (e.g. from API or state); otherwise returns empty health.
 * Campaign-scoped; no assumption that only one campaign exists.
 */
export async function getCampaignHealth(
  campaignId: string,
  fetchActivities?: FetchActivitiesForCampaign,
  options: ComputeCampaignHealthOptions = {}
): Promise<CampaignHealth> {
  if (!fetchActivities) {
    return computeCampaignHealth([], options);
  }
  const activities = await fetchActivities(campaignId);
  return computeCampaignHealth(activities, options);
}

// ---------------------------------------------------------------------------
// CMO Portfolio (cross-campaign aggregation)
// ---------------------------------------------------------------------------

export type PortfolioHealthColor = 'green' | 'orange' | 'red';

/** Campaign risk score 0–100. Rule-based; explainable. */
export type RiskLevel = 'healthy' | 'watch' | 'critical';

/** Weighted points per signal (explainable formula). High: overdue, blocked. Medium: pending, unassigned, bottleneck. */
export const RISK_WEIGHTS = {
  /** Per overdue activity (high). */
  overdue: 25,
  /** Per blocked activity (high). */
  blocked: 25,
  /** Per pending approval (medium). */
  pendingApproval: 10,
  /** Per unassigned activity (medium). */
  unassigned: 10,
  /** Per stage with bottleneck (medium). */
  bottleneckPerStage: 15,
} as const;

const RISK_CAP = 100;
const RISK_HEALTHY_MAX = 30;
const RISK_WATCH_MAX = 60;

export interface CampaignRiskScore {
  score: number;
  level: RiskLevel;
  /** Top contributors for UI explanation (e.g. "2 overdue", "1 blocked"). */
  contributors: string[];
}

/**
 * Rule-based campaign risk score (0–100). Explainable; no black-box AI.
 * Recalculates from CampaignHealth (overdue, blocked, pending, unassigned, bottlenecks).
 */
export function computeCampaignRiskScore(health: CampaignHealth): CampaignRiskScore {
  const bottleneckStages = health.stageHealthSummary.filter((s) => s.hasIssues).length;
  const overduePts = health.overdueCount * RISK_WEIGHTS.overdue;
  const blockedPts = health.blockedCount * RISK_WEIGHTS.blocked;
  const pendingPts = health.pendingApprovalCount * RISK_WEIGHTS.pendingApproval;
  const unassignedPts = health.unassignedCount * RISK_WEIGHTS.unassigned;
  const bottleneckPts = bottleneckStages * RISK_WEIGHTS.bottleneckPerStage;

  const raw = overduePts + blockedPts + pendingPts + unassignedPts + bottleneckPts;
  const score = Math.min(RISK_CAP, Math.round(raw));

  let level: RiskLevel = 'healthy';
  if (score > RISK_WATCH_MAX) level = 'critical';
  else if (score > RISK_HEALTHY_MAX) level = 'watch';

  const items: Array<{ label: string; points: number }> = [];
  if (health.overdueCount > 0) items.push({ label: `${health.overdueCount} overdue`, points: overduePts });
  if (health.blockedCount > 0) items.push({ label: `${health.blockedCount} blocked`, points: blockedPts });
  if (health.pendingApprovalCount > 0) items.push({ label: `${health.pendingApprovalCount} pending approval`, points: pendingPts });
  if (health.unassignedCount > 0) items.push({ label: `${health.unassignedCount} unassigned`, points: unassignedPts });
  if (bottleneckStages > 0) items.push({ label: `${bottleneckStages} stage bottleneck(s)`, points: bottleneckPts });
  items.sort((a, b) => b.points - a.points);
  const contributors = items.slice(0, 5).map((i) => i.label);

  return { score, level, contributors };
}

// ---------------------------------------------------------------------------
// Predicted Risk (Next Week) — rule-based trend, no time-series required
// ---------------------------------------------------------------------------

export type RiskTrend = 'increasing' | 'stable' | 'improving';

export interface CampaignRiskPrediction {
  /** Predicted risk score 0–100 (next week). */
  predictedScore: number;
  trend: RiskTrend;
  /** One-line explainable reason (e.g. "Risk increasing due to approval delays."). */
  explanation: string;
}

/**
 * Rule-based predicted risk for next week using current health signals.
 * No historical data: trend inferred from approval backlog, overdue, bottlenecks, unassigned.
 * Use for proactive early-warning; update daily or throttled.
 */
export function computeCampaignRiskPrediction(health: CampaignHealth): CampaignRiskPrediction {
  const current = computeCampaignRiskScore(health);
  const bottleneckStages = health.stageHealthSummary.filter((s) => s.hasIssues).length;

  // Trend: increasing if any high-pressure signal; improving if clean; else stable
  const hasApprovalBacklog = health.pendingApprovalCount >= 2;
  const hasOverduePressure = health.overdueCount > 0;
  const hasBlockedPressure = health.blockedCount > 0;
  const hasCongestion = bottleneckStages > 0 && health.totalActivities > 2;
  const hasUnassignedPressure = health.unassignedCount >= 2;

  let trend: RiskTrend = 'stable';
  let explanation: string;
  let predictedScore = current.score;

  if (hasOverduePressure || hasBlockedPressure || hasApprovalBacklog || hasCongestion || hasUnassignedPressure) {
    trend = 'increasing';
    predictedScore = Math.min(RISK_CAP, current.score + 12);
    if (hasApprovalBacklog && (health.pendingApprovalCount >= health.overdueCount + health.blockedCount || !hasOverduePressure)) {
      explanation = 'Risk increasing due to approval delays.';
    } else if (hasOverduePressure) {
      explanation = 'Risk increasing due to overdue backlog.';
    } else if (hasBlockedPressure) {
      explanation = 'Risk increasing due to blocked items.';
    } else if (hasCongestion) {
      explanation = 'Risk increasing due to stage congestion.';
    } else if (hasUnassignedPressure) {
      explanation = 'Risk increasing due to unassigned work.';
    } else {
      explanation = 'Risk increasing; monitor key metrics.';
    }
  } else if (current.score <= RISK_HEALTHY_MAX && health.overdueCount === 0 && health.blockedCount === 0) {
    trend = 'improving';
    predictedScore = Math.max(0, current.score - 8);
    explanation = 'Risk improving; maintain current pace.';
  } else {
    explanation = 'Risk stable; monitor key metrics.';
  }

  predictedScore = Math.min(RISK_CAP, Math.max(0, Math.round(predictedScore)));

  return {
    predictedScore,
    trend,
    explanation,
  };
}

/**
 * Resolves predicted risk for a campaign (async). Fetches health then computes prediction.
 * For portfolio, call after getCampaignHealth; use computeCampaignRiskPrediction(health) to avoid double fetch.
 */
export async function getCampaignRiskPrediction(
  campaignId: string,
  fetchActivities: FetchActivitiesForCampaign,
  options: ComputeCampaignHealthOptions = {}
): Promise<CampaignRiskPrediction> {
  const health = await getCampaignHealth(campaignId, fetchActivities, options);
  return computeCampaignRiskPrediction(health);
}

// ---------------------------------------------------------------------------
// Suggested Options (user-choice model) — 2–3 alternative strategies, AI never auto-executes
// ---------------------------------------------------------------------------

export type PreventiveActionCategory = 'CLEAR' | 'ASSIGN' | 'ADVANCE';

export type ImpactLevel = 'low' | 'medium' | 'high';

/** Filter hint for "Open Related Items" (aligns with ExecutionFilters). */
export interface PreventiveActionFilterHint {
  stage?: string | null;
  approvalStatus?: string | null;
}

export interface PreventiveAction {
  category: PreventiveActionCategory;
  /** Option title (executive-friendly). */
  label: string;
  /** Short reason (1 line). */
  reason?: string;
  /** Impact level for user prioritization. */
  impactLevel: ImpactLevel;
  /** Optional filter to apply when user opens campaign radar. */
  suggestedFilter?: PreventiveActionFilterHint;
  /** Set when option is reordered to top based on user's past choices (adaptive learning). */
  preferredByUser?: boolean;
}

/** Result of getUserDecisionPattern; used to reorder options. Higher index = less preferred. */
export interface UserDecisionPattern {
  /** Categories ordered by preference (first = most preferred). */
  preferredOrder: PreventiveActionCategory[];
}

const SUGGESTED_OPTIONS_MAX = 3;

/**
 * Generates 2–3 alternative options from health + prediction. Each option is a different strategy
 * (clear blockers / assign ownership / advance workflow). No duplicates. User explicitly selects;
 * AI never auto-executes.
 */
export function computePreventiveActions(
  health: CampaignHealth,
  prediction: CampaignRiskPrediction
): PreventiveAction[] {
  const actions: PreventiveAction[] = [];

  // CLEAR: remove blockers (high impact)
  if (health.blockedCount > 0) {
    actions.push({
      category: 'CLEAR',
      label: 'Clear blocked items',
      reason: `${health.blockedCount} blocked; unblock to reduce risk.`,
      impactLevel: 'high',
    });
  }
  if (health.overdueCount > 0 && actions.length < SUGGESTED_OPTIONS_MAX) {
    actions.push({
      category: 'CLEAR',
      label: 'Clear overdue backlog',
      reason: `${health.overdueCount} overdue; resolve or reschedule.`,
      impactLevel: 'high',
    });
  }

  // ASSIGN: fix ownership (medium impact)
  if (health.unassignedCount > 0 && actions.length < SUGGESTED_OPTIONS_MAX) {
    const bottleneckStage = health.stageHealthSummary.find((s) => s.hasIssues);
    actions.push({
      category: 'ASSIGN',
      label: 'Assign unassigned activities',
      reason: `${health.unassignedCount} unassigned; assign to reduce delay risk.`,
      impactLevel: 'medium',
      suggestedFilter: bottleneckStage ? { stage: bottleneckStage.stage } : undefined,
    });
  }

  // ADVANCE: move workflow (medium/high)
  if (health.pendingApprovalCount > 0 && actions.length < SUGGESTED_OPTIONS_MAX) {
    actions.push({
      category: 'ADVANCE',
      label: 'Advance pending approvals',
      reason: `${health.pendingApprovalCount} waiting approval; review to keep flow moving.`,
      impactLevel: 'medium',
      suggestedFilter: { approvalStatus: 'pending' },
    });
  }
  const bottleneckStage = health.stageHealthSummary.find((s) => s.hasIssues);
  if (bottleneckStage && health.totalActivities > 2 && actions.length < SUGGESTED_OPTIONS_MAX) {
    actions.push({
      category: 'ADVANCE',
      label: 'Move items past bottleneck',
      reason: `Congestion in ${bottleneckStage.stage}; advance items to next stage.`,
      impactLevel: 'high',
      suggestedFilter: { stage: bottleneckStage.stage },
    });
  }

  return actions.slice(0, SUGGESTED_OPTIONS_MAX);
}

/**
 * Reorders options by user preference (adaptive learning). All options remain visible; only order changes.
 * Marks the top preferred option with preferredByUser when pattern is applied.
 */
export function reorderOptionsByPreference(
  options: PreventiveAction[],
  pattern: UserDecisionPattern | null
): PreventiveAction[] {
  if (!pattern || pattern.preferredOrder.length === 0) return options;

  const orderIndex = (c: PreventiveActionCategory) => {
    const i = pattern.preferredOrder.indexOf(c);
    return i >= 0 ? i : 999;
  };
  const sorted = [...options].sort((a, b) => orderIndex(a.category) - orderIndex(b.category));
  const topCategory = pattern.preferredOrder[0];
  return sorted.map((opt) => ({
    ...opt,
    preferredByUser: opt.category === topCategory ? true : undefined,
  }));
}

/**
 * Resolves preventive actions for a campaign (async).
 * For portfolio, use computePreventiveActions(health, prediction) after health/prediction are available.
 */
export async function getPreventiveActions(
  campaignId: string,
  fetchActivities: FetchActivitiesForCampaign,
  options: ComputeCampaignHealthOptions = {}
): Promise<PreventiveAction[]> {
  const health = await getCampaignHealth(campaignId, fetchActivities, options);
  const prediction = computeCampaignRiskPrediction(health);
  return computePreventiveActions(health, prediction);
}

export interface CampaignHealthCard {
  campaignId: string;
  campaignName: string;
  healthColor: PortfolioHealthColor;
  overdueCount: number;
  pendingApprovalCount: number;
  hasBottleneck: boolean;
  totalActivities: number;
  /** Rule-based risk 0–100. Explainable. */
  riskScore: number;
  riskLevel: RiskLevel;
  /** Top contributors to risk (for UI). */
  riskContributors: string[];
  /** Predicted risk next week; secondary indicator. */
  prediction: CampaignRiskPrediction;
  /** 2–3 preventive actions to reduce predicted risk. */
  preventiveActions: PreventiveAction[];
}

export interface PortfolioAttentionItem {
  campaignId: string;
  campaignName: string;
  activityId: string;
  activityTitle: string;
  reason: AttentionReason;
  priority: number;
}

export interface CompanyPortfolioHealth {
  companyNarrative: string;
  campaignsNeedingAttention: string[];
  campaignCards: CampaignHealthCard[];
  attentionFeed: PortfolioAttentionItem[];
}

function getPortfolioHealthColor(health: CampaignHealth): PortfolioHealthColor {
  if (health.overdueCount > 0 || health.blockedCount > 0) return 'red';
  if (health.pendingApprovalCount > 0 || health.unassignedCount > 0) return 'orange';
  return 'green';
}

function getHasBottleneck(health: CampaignHealth): boolean {
  return health.stageHealthSummary.some((s) => s.hasIssues);
}

const PORTFOLIO_ATTENTION_LIMIT = 15;

/**
 * Aggregates health across multiple campaigns for CMO Portfolio Radar.
 * Reuses getCampaignHealth(campaignId) per campaign; no cross-campaign execution.
 */
export async function getCompanyPortfolioHealth(
  campaigns: Array<{ id: string; name: string }>,
  fetchActivities: FetchActivitiesForCampaign,
  options: ComputeCampaignHealthOptions = {}
): Promise<CompanyPortfolioHealth> {
  const results = await Promise.all(
    campaigns.map(async (c) => ({
      campaignId: c.id,
      campaignName: c.name,
      health: await getCampaignHealth(c.id, fetchActivities, options),
    }))
  );

  let totalOverdue = 0;
  let totalBlocked = 0;
  let totalPending = 0;
  const campaignsNeedingAttention: string[] = [];
  const campaignCards: CampaignHealthCard[] = [];
  const attentionFeed: PortfolioAttentionItem[] = [];

  for (const { campaignId, campaignName, health } of results) {
    totalOverdue += health.overdueCount;
    totalBlocked += health.blockedCount;
    totalPending += health.pendingApprovalCount;
    if (health.overdueCount > 0 || health.blockedCount > 0 || health.pendingApprovalCount > 0 || health.unassignedCount > 0) {
      campaignsNeedingAttention.push(campaignName);
    }
    const risk = computeCampaignRiskScore(health);
    const prediction = computeCampaignRiskPrediction(health);
    const preventiveActions = computePreventiveActions(health, prediction);
    campaignCards.push({
      campaignId,
      campaignName,
      healthColor: getPortfolioHealthColor(health),
      overdueCount: health.overdueCount,
      pendingApprovalCount: health.pendingApprovalCount,
      hasBottleneck: getHasBottleneck(health),
      totalActivities: health.totalActivities,
      riskScore: risk.score,
      riskLevel: risk.level,
      riskContributors: risk.contributors,
      prediction,
      preventiveActions,
    });
    for (const item of health.attentionItems) {
      attentionFeed.push({
        campaignId,
        campaignName,
        activityId: item.activityId,
        activityTitle: item.activity.title || 'Untitled',
        reason: item.reason,
        priority: item.priority,
      });
    }
  }

  attentionFeed.sort((a, b) => b.priority - a.priority);
  const topAttention = attentionFeed.slice(0, PORTFOLIO_ATTENTION_LIMIT);

  let companyNarrative: string;
  if (results.length === 0) {
    companyNarrative = 'No campaigns in scope.';
  } else if (totalOverdue > 0 || totalBlocked > 0) {
    companyNarrative = `Overall execution has ${totalOverdue + totalBlocked} item(s) past due or blocked across ${results.length} campaign(s). ${campaignsNeedingAttention.length > 0 ? `Campaigns needing attention: ${campaignsNeedingAttention.slice(0, 5).join(', ')}${campaignsNeedingAttention.length > 5 ? '…' : ''}.` : ''}`;
  } else if (totalPending > 0 || campaignsNeedingAttention.length > 0) {
    companyNarrative = `Overall execution is largely on track across ${results.length} campaign(s). ${campaignsNeedingAttention.length > 0 ? `Consider reviewing: ${campaignsNeedingAttention.slice(0, 3).join(', ')}.` : ''}`;
  } else {
    companyNarrative = `All ${results.length} campaign(s) are on track.`;
  }

  return {
    companyNarrative,
    campaignsNeedingAttention,
    campaignCards,
    attentionFeed: topAttention,
  };
}
