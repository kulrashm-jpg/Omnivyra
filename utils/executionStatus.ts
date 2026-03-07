/**
 * Unified execution progress tracking.
 * Statuses: PENDING → IN_PROGRESS → FINALIZED → SCHEDULED.
 * Calendar and activity cards derive border/badge/background from this.
 *
 * Store status on execution_jobs (e.g. execution_status: ExecutionStatus).
 * Calendar should derive color from execution status via getExecutionStatusBackground.
 * Legacy readiness (ready | missing_media | incomplete) should be replaced by this.
 */

export type ExecutionStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'FINALIZED'
  | 'SCHEDULED';

/** Rules for status:
 * - PENDING: Workspace never opened.
 * - IN_PROGRESS: Content generated but not finalized.
 * - FINALIZED: Content finalized but not scheduled.
 * - SCHEDULED: Content scheduled with date/time.
 */
export const EXECUTION_STATUS_RULES: Record<ExecutionStatus, string> = {
  PENDING: 'Workspace never opened.',
  IN_PROGRESS: 'Content generated but not finalized.',
  FINALIZED: 'Content finalized but not scheduled.',
  SCHEDULED: 'Content scheduled with date/time.',
};

/** Status → background color (for activity/calendar cards). Unified rule: background = status. */
export const EXECUTION_STATUS_BG: Record<ExecutionStatus, string> = {
  PENDING: 'bg-gray-50',
  IN_PROGRESS: 'bg-yellow-50',
  FINALIZED: 'bg-green-50',
  SCHEDULED: 'bg-purple-50',
};

/** Status → badge/pill classes */
export const EXECUTION_STATUS_BADGE: Record<ExecutionStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700 border-gray-200',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  FINALIZED: 'bg-green-100 text-green-800 border-green-200',
  SCHEDULED: 'bg-purple-100 text-purple-800 border-purple-200',
};

export function getExecutionStatusBackground(status?: ExecutionStatus | string | null): string {
  if (!status || typeof status !== 'string') return EXECUTION_STATUS_BG.PENDING;
  const key = status.toUpperCase() as ExecutionStatus;
  return EXECUTION_STATUS_BG[key] ?? EXECUTION_STATUS_BG.PENDING;
}

export function getExecutionStatusBadgeClasses(status?: ExecutionStatus | string | null): string {
  if (!status || typeof status !== 'string') return EXECUTION_STATUS_BADGE.PENDING;
  const key = status.toUpperCase() as ExecutionStatus;
  return EXECUTION_STATUS_BADGE[key] ?? EXECUTION_STATUS_BADGE.PENDING;
}
