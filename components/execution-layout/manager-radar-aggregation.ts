/**
 * Manager Radar — data aggregation for campaign health.
 * Signal-based only. No message thread; no editing from radar.
 */

import type { Activity, ActivityStage } from '../activity-board/types';
import { ACTIVITY_STAGES } from '../activity-board/types';
import { isOverdue, isBlocked } from '../activity-board/board-indicators';

export interface HealthSummary {
  totalActivities: number;
  pendingApproval: number;
  blocked: number;
  overdue: number;
  scheduled: number;
}

export interface StageRadarItem {
  stage: ActivityStage;
  count: number;
  hasIssues: boolean;
  overdueCount: number;
  blockedCount: number;
}

/** Attention reason for feed ordering (priority). */
export type AttentionReason = 'overdue' | 'waiting_approval' | 'unassigned' | 'blocked';

/** Signal priority: higher = show first in attention feed. */
export const ATTENTION_PRIORITY: Record<AttentionReason, number> = {
  overdue: 100,
  blocked: 90,
  waiting_approval: 85,
  unassigned: 70,
};

export interface AttentionFeedItem {
  activity: Activity;
  reason: AttentionReason;
  priority: number;
}

function isUnassigned(a: Activity): boolean {
  return !a.owner_id && !a.owner_name;
}

function isPendingApproval(a: Activity): boolean {
  return a.approval_status === 'pending';
}

/**
 * Aggregates health summary counts from activities.
 * Scheduled = count in SCHEDULE stage.
 */
export function aggregateHealthSummary(
  activities: Activity[],
  now: number = Date.now()
): HealthSummary {
  let pendingApproval = 0;
  let blocked = 0;
  let overdue = 0;
  let scheduled = 0;
  for (const a of activities) {
    if (a.approval_status === 'pending') pendingApproval++;
    if (isBlocked(a)) blocked++;
    if (isOverdue(a, now)) overdue++;
    if (a.stage === 'SCHEDULE') scheduled++;
  }
  return {
    totalActivities: activities.length,
    pendingApproval,
    blocked,
    overdue,
    scheduled,
  };
}

/**
 * Per-stage counts and issue flags for Stage Radar.
 * hasIssues = stage has any overdue or blocked activity.
 */
export function aggregateStageRadar(
  activities: Activity[],
  now: number = Date.now()
): StageRadarItem[] {
  const byStage: Record<ActivityStage, { count: number; overdue: number; blocked: number }> = {
    PLAN: { count: 0, overdue: 0, blocked: 0 },
    CREATE: { count: 0, overdue: 0, blocked: 0 },
    REPURPOSE: { count: 0, overdue: 0, blocked: 0 },
    SCHEDULE: { count: 0, overdue: 0, blocked: 0 },
    SHARE: { count: 0, overdue: 0, blocked: 0 },
  };
  for (const a of activities) {
    const row = byStage[a.stage];
    if (!row) continue;
    row.count++;
    if (isOverdue(a, now)) row.overdue++;
    if (isBlocked(a)) row.blocked++;
  }
  return ACTIVITY_STAGES.map((stage) => {
    const row = byStage[stage];
    return {
      stage,
      count: row.count,
      hasIssues: row.overdue > 0 || row.blocked > 0,
      overdueCount: row.overdue,
      blockedCount: row.blocked,
    };
  });
}

/**
 * Builds attention feed list: overdue, waiting approval, unassigned, blocked.
 * Ordered by signal priority: OVERDUE > BLOCKED > APPROVAL > UNASSIGNED.
 * Each activity appears at most once (highest-priority reason).
 */
export function buildAttentionFeed(
  activities: Activity[],
  now: number = Date.now()
): AttentionFeedItem[] {
  const items: AttentionFeedItem[] = [];
  const seen = new Set<string>();
  const byPriority: AttentionFeedItem[] = [];

  for (const a of activities) {
    let reason: AttentionReason | null = null;
    if (isOverdue(a, now)) reason = 'overdue';
    else if (isBlocked(a)) reason = a.approval_status === 'pending' ? 'waiting_approval' : 'blocked';
    else if (isUnassigned(a)) reason = 'unassigned';
    if (reason == null) continue;
    const priority = ATTENTION_PRIORITY[reason];
    byPriority.push({ activity: a, reason, priority });
  }

  byPriority.sort((x, y) => {
    const p = y.priority - x.priority;
    if (p !== 0) return p;
    return (x.activity.title || '').localeCompare(y.activity.title || '');
  });

  for (const item of byPriority) {
    if (seen.has(item.activity.id)) continue;
    seen.add(item.activity.id);
    items.push(item);
  }
  return items;
}
