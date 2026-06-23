/**
 * PHASE CAMPAIGN-HEALTH-BOLT-ALIGNMENT — execution-health authority.
 *
 * `campaign-health-engine.ts` scores health purely from the collaboration
 * Activity board (overdue / blocked / pending-approval / unassigned). It never
 * reads BOLT execution rows, so a campaign can show GREEN while creator
 * execution is blocked (render_failed, publish failed, awaiting upload, or a
 * scheduled_posts ↔ daily_content_plans write drift).
 *
 * This module is the SMALLEST safe closure: a SEPARATE, additive, pure
 * execution-health score derived from the actual execution states. It does NOT
 * modify the Activity-board engine, the scheduler, the publisher, the creator
 * workflow, campaign-completion logic, or video isolation. A worst-of combiner
 * (`combineHealthColor`) lets a consumer overlay it on the Activity-board color
 * when it wants the full truth — but nothing here is wired automatically, so
 * existing behaviour stays byte-identical.
 *
 * UI-safe: depends on no backend / queue / DB module. The DB-backed resolver
 * (`backend/services/creator/executionHealthResolver.ts`) feeds it real rows.
 */

/** Same vocabulary as PortfolioHealthColor so the two compose directly. */
export type ExecutionHealthColor = 'green' | 'orange' | 'red';

export type ExecutionHealthLevel = 'healthy' | 'warning' | 'critical';

/**
 * Classification of one `daily_content_plans.content_status` /
 * creator-lifecycle value. Literals (not an enum import) so this stays
 * self-documenting and UI-safe; `upload_failed` is included alongside the
 * registry's `render_failed` (the canonical mapper treats both as failed).
 */
const CONTENT_STATUS_HEALTH: Record<string, ExecutionHealthLevel> = {
  // critical — execution is stuck and cannot self-resolve.
  render_failed: 'critical',
  upload_failed: 'critical',
  // warning — legitimate in-flight creator work that is NOT yet done; a
  // campaign with these is not fully GREEN.
  awaiting_media_upload: 'warning',
  ready_for_schedule: 'warning',
  render_ready: 'warning',
  media_uploaded: 'warning',
  // healthy — terminal / done.
  scheduled: 'healthy',
  published: 'healthy',
};

/** Classification of one `scheduled_posts.status` value. */
const SCHEDULED_POST_STATUS_HEALTH: Record<string, ExecutionHealthLevel> = {
  failed: 'critical',
  publishing: 'healthy',
  scheduled: 'healthy',
  published: 'healthy',
  // 'draft' / 'cancelled' are intentional, not health concerns.
  draft: 'healthy',
  cancelled: 'healthy',
};

export function classifyContentStatusHealth(status: string | null | undefined): ExecutionHealthLevel {
  const key = String(status || '').toLowerCase().trim();
  if (!key) return 'healthy'; // text rows / no creator lifecycle — not a creator concern.
  return CONTENT_STATUS_HEALTH[key] ?? 'healthy';
}

export function classifyScheduledPostHealth(status: string | null | undefined): ExecutionHealthLevel {
  const key = String(status || '').toLowerCase().trim();
  if (!key) return 'healthy';
  return SCHEDULED_POST_STATUS_HEALTH[key] ?? 'healthy';
}

export interface ExecutionHealth {
  color: ExecutionHealthColor;
  level: ExecutionHealthLevel;
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
  /** Human-readable contributors, ordered critical-first (e.g. "2 render failed"). */
  reasons: string[];
  /** Per-signal tallies for UI / API surfacing. */
  counts: {
    renderFailed: number;
    uploadFailed: number;
    publishFailed: number;
    awaitingUpload: number;
    readyForSchedule: number;
    renderReady: number;
    mediaUploaded: number;
    scheduleDriftOrphan: number;
    scheduleDriftDangling: number;
  };
}

export interface ComputeExecutionHealthInput {
  /** `daily_content_plans.content_status` (or creator_lifecycle_state) per row. */
  dailyPlanStatuses?: Array<string | null | undefined>;
  /** `scheduled_posts.status` per row. */
  scheduledPostStatuses?: Array<string | null | undefined>;
  /** Creator scheduling write-drift (from the reconciler) — both are warnings. */
  scheduleDrift?: { orphanCount?: number; danglingCount?: number };
}

function levelToColor(level: ExecutionHealthLevel): ExecutionHealthColor {
  return level === 'critical' ? 'red' : level === 'warning' ? 'orange' : 'green';
}

/**
 * PURE execution-health aggregation. Worst-of across every execution signal:
 *   red  — any render_failed / upload_failed / publish-failed row.
 *   orange — any pending creator work (awaiting upload / ready / rendered but
 *            unscheduled) or any creator schedule drift.
 *   green — everything terminal (scheduled / published) or no creator concern.
 */
export function computeExecutionHealth(input: ComputeExecutionHealthInput): ExecutionHealth {
  const counts = {
    renderFailed: 0,
    uploadFailed: 0,
    publishFailed: 0,
    awaitingUpload: 0,
    readyForSchedule: 0,
    renderReady: 0,
    mediaUploaded: 0,
    scheduleDriftOrphan: Math.max(0, input.scheduleDrift?.orphanCount ?? 0),
    scheduleDriftDangling: Math.max(0, input.scheduleDrift?.danglingCount ?? 0),
  };

  let criticalCount = 0;
  let warningCount = 0;
  let healthyCount = 0;

  for (const raw of input.dailyPlanStatuses ?? []) {
    const key = String(raw || '').toLowerCase().trim();
    switch (key) {
      case 'render_failed': counts.renderFailed++; break;
      case 'upload_failed': counts.uploadFailed++; break;
      case 'awaiting_media_upload': counts.awaitingUpload++; break;
      case 'ready_for_schedule': counts.readyForSchedule++; break;
      case 'render_ready': counts.renderReady++; break;
      case 'media_uploaded': counts.mediaUploaded++; break;
      default: break;
    }
    const level = classifyContentStatusHealth(raw);
    if (level === 'critical') criticalCount++;
    else if (level === 'warning') warningCount++;
    else healthyCount++;
  }

  for (const raw of input.scheduledPostStatuses ?? []) {
    const level = classifyScheduledPostHealth(raw);
    if (level === 'critical') { counts.publishFailed++; criticalCount++; }
    else if (level === 'warning') warningCount++;
    else healthyCount++;
  }

  // Schedule drift contributes warnings (recoverable integrity issues).
  warningCount += counts.scheduleDriftOrphan + counts.scheduleDriftDangling;

  const level: ExecutionHealthLevel =
    criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy';

  const reasons: string[] = [];
  if (counts.renderFailed > 0) reasons.push(`${counts.renderFailed} render failed`);
  if (counts.uploadFailed > 0) reasons.push(`${counts.uploadFailed} upload failed`);
  if (counts.publishFailed > 0) reasons.push(`${counts.publishFailed} publish failed`);
  if (counts.awaitingUpload > 0) reasons.push(`${counts.awaitingUpload} awaiting upload`);
  if (counts.readyForSchedule > 0) reasons.push(`${counts.readyForSchedule} ready, unscheduled`);
  if (counts.renderReady > 0) reasons.push(`${counts.renderReady} rendered, unscheduled`);
  if (counts.mediaUploaded > 0) reasons.push(`${counts.mediaUploaded} uploaded, unscheduled`);
  const driftTotal = counts.scheduleDriftOrphan + counts.scheduleDriftDangling;
  if (driftTotal > 0) reasons.push(`${driftTotal} schedule drift`);

  return {
    color: levelToColor(level),
    level,
    criticalCount,
    warningCount,
    healthyCount,
    reasons,
    counts,
  };
}

const COLOR_RANK: Record<ExecutionHealthColor, number> = { green: 0, orange: 1, red: 2 };

/**
 * Worst-of combiner so an Activity-board health color and the execution-health
 * color can be overlaid into a single truthful badge. Pure; the consumer
 * decides whether to use it (no auto-wiring → no regression).
 */
export function combineHealthColor(
  activityColor: ExecutionHealthColor,
  executionColor: ExecutionHealthColor,
): ExecutionHealthColor {
  return COLOR_RANK[activityColor] >= COLOR_RANK[executionColor] ? activityColor : executionColor;
}
