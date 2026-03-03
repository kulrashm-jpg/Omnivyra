/**
 * Board Intelligence Indicators — state mapping and rendering priority.
 * Priority: OVERDUE > BLOCKED > APPROVAL > COLLABORATION > OWNERSHIP.
 * Icon-first, one-line row; no text-heavy layout.
 */

import type { Activity, ApprovalStatus } from './types';

/** Display priority: higher = show first (left). */
export const INDICATOR_PRIORITY = {
  OVERDUE: 100,
  BLOCKED: 90,
  APPROVAL: 80,
  COLLABORATION: 70,
  OWNERSHIP: 60,
} as const;

export type IndicatorKind =
  | 'attention'   // requires action: overdue, waiting approval, blocked
  | 'approval'    // Draft / Submitted / Approved / Changes Requested
  | 'collaboration' // message count
  | 'ownership'   // assigned or unassigned
  | 'flow_blocker' // waiting review or approval
  | 'time_risk';  // near due or overdue

export type ApprovalDisplayState = 'draft' | 'submitted' | 'approved' | 'changes_requested' | 'rejected';

export interface BoardIndicatorItem {
  id: string;
  kind: IndicatorKind;
  priority: number;
  /** Tooltip / accessibility label */
  label: string;
  /** Tailwind color for icon (e.g. text-red-500, text-amber-500) */
  colorClass: string;
  /** Optional count (e.g. message count) */
  count?: number;
  /** Approval state when kind === 'approval' */
  approvalState?: ApprovalDisplayState;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Hours considered "near due" (show time risk). */
const NEAR_DUE_HOURS = 48;

function parseDue(due_date?: string, due_time?: string): number | null {
  if (!due_date) return null;
  const datePart = due_date.trim();
  if (!datePart) return null;
  const timePart = due_time?.trim() || '00:00';
  const combined = timePart.length <= 5 ? `${datePart}T${timePart}:00` : `${datePart}T${timePart}`;
  const ms = Date.parse(combined);
  return Number.isFinite(ms) ? ms : null;
}

/** Returns true if due date is in the past (or today past due time). */
export function isOverdue(activity: Activity, now: number = Date.now()): boolean {
  const due = parseDue(activity.due_date, activity.due_time);
  return due != null && due < now;
}

/** Returns true if due within NEAR_DUE_HOURS. */
export function isNearDue(activity: Activity, now: number = Date.now()): boolean {
  const due = parseDue(activity.due_date, activity.due_time);
  if (due == null) return false;
  const diff = due - now;
  return diff >= 0 && diff <= NEAR_DUE_HOURS * 60 * 60 * 1000;
}

/** Blocked = waiting review or approval (pending or request_changes). */
export function isBlocked(activity: Activity): boolean {
  return activity.approval_status === 'pending' || activity.approval_status === 'request_changes';
}

/** Attention = requires action: overdue, waiting approval, or blocked. */
export function needsAttention(activity: Activity, now: number = Date.now()): boolean {
  return isOverdue(activity, now) || isBlocked(activity);
}

function approvalToDisplayState(s: ApprovalStatus): ApprovalDisplayState {
  switch (s) {
    case 'pending': return 'submitted';
    case 'approved': return 'approved';
    case 'rejected': return 'rejected';
    case 'request_changes': return 'changes_requested';
    default: return 'submitted';
  }
}

/**
 * Builds the ordered list of indicators for the card.
 * Priority: OVERDUE > BLOCKED > APPROVAL > COLLABORATION > OWNERSHIP.
 */
export function getBoardIndicators(
  activity: Activity,
  messageCount: number,
  now: number = Date.now()
): BoardIndicatorItem[] {
  const items: BoardIndicatorItem[] = [];
  const overdue = isOverdue(activity, now);
  const nearDue = isNearDue(activity, now);
  const blocked = isBlocked(activity);
  const attention = needsAttention(activity, now);

  // 1. Time Risk (overdue or near due)
  if (overdue) {
    items.push({
      id: 'time-risk-overdue',
      kind: 'time_risk',
      priority: INDICATOR_PRIORITY.OVERDUE,
      label: 'Overdue',
      colorClass: 'text-red-500',
    });
  } else if (nearDue) {
    items.push({
      id: 'time-risk-near',
      kind: 'time_risk',
      priority: INDICATOR_PRIORITY.OVERDUE,
      label: 'Due soon',
      colorClass: 'text-amber-500',
    });
  }

  // 2. Attention (requires action) — show if blocked/waiting and not already shown as overdue
  if (attention && !overdue) {
    items.push({
      id: 'attention',
      kind: 'attention',
      priority: INDICATOR_PRIORITY.BLOCKED,
      label: blocked ? 'Waiting approval or changes' : 'Requires action',
      colorClass: 'text-amber-500',
    });
  }

  // 3. Flow Blocker — same as blocked; fold into attention for display to avoid duplicate. Skip if we already show attention.
  // (So we don't add a separate flow_blocker icon; attention covers it.)

  // 4. Approval (Draft / Submitted / Approved / Changes Requested)
  const approvalState = approvalToDisplayState(activity.approval_status);
  items.push({
    id: 'approval',
    kind: 'approval',
    priority: INDICATOR_PRIORITY.APPROVAL,
    label: approvalState.replace(/_/g, ' '),
    colorClass:
      approvalState === 'approved'
        ? 'text-emerald-600'
        : approvalState === 'rejected'
        ? 'text-red-500'
        : approvalState === 'changes_requested'
        ? 'text-amber-500'
        : 'text-gray-500',
    approvalState,
  });

  // 5. Collaboration (message count)
  items.push({
    id: 'collaboration',
    kind: 'collaboration',
    priority: INDICATOR_PRIORITY.COLLABORATION,
    label: messageCount === 0 ? 'No messages' : `${messageCount} message(s)`,
    colorClass: messageCount > 0 ? 'text-indigo-500' : 'text-gray-400',
    count: messageCount,
  });

  // 6. Ownership
  const assigned = Boolean(activity.owner_id ?? activity.owner_name);
  items.push({
    id: 'ownership',
    kind: 'ownership',
    priority: INDICATOR_PRIORITY.OWNERSHIP,
    label: assigned ? `Assigned to ${activity.owner_name || 'user'}` : 'Unassigned',
    colorClass: assigned ? 'text-gray-600' : 'text-amber-500',
  });

  return items.sort((a, b) => b.priority - a.priority);
}
