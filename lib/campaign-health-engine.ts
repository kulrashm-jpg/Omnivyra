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


// Agent-B split: risk scoring / prediction / preventive actions / portfolio
// health live in ./campaign-health-engine-risk (behavior-preserving; the
// import cycle is type+call-time only, safe in TS/Node module resolution).
export * from './campaign-health-engine-risk';
