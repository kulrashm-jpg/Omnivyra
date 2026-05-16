/**
 * Creator Lifecycle State Machine
 *
 * Centralized, validated transitions between the per-row lifecycle states
 * established by the per-row eligibility foundation. Replaces ad-hoc state
 * writes with explicit `applyTransition(...)` calls so the audit trail,
 * legality checks, and JSON mirroring stay consistent across:
 *
 *   - the BOLT runtime (`creatorAssetGenerationRuntime.ts`)
 *   - the upload API (`pages/api/activity-workspace/[id]/upload-media.ts`)
 *   - the scheduler (`structuredPlanScheduler.ts`)
 *   - future re-upload / retry surfaces
 *
 * The state lives on `daily_content_plans.content` (JSON) under
 * `creator_lifecycle_state`. The legacy `content_status` column is
 * mirrored for backward compatibility — it is free-text TEXT, no CHECK
 * constraint (see database/daily_content_plans_creator_asset.sql:11-12),
 * so writing any of the lifecycle values directly is safe.
 *
 * NO DB migration is required by this module.
 */

import type { CreatorLifecycleState } from './creatorGovernanceRegistry';

/**
 * Extended lifecycle set used by the FSM. Adds `upload_failed` to the
 * vocabulary established in the governance registry so callers don't have
 * to widen `CreatorLifecycleState` for a transient failure state.
 */
export type CreatorLifecycleStateExt = CreatorLifecycleState | 'upload_failed';

export const LIFECYCLE_STATES = {
  AWAITING_MEDIA_UPLOAD: 'awaiting_media_upload',
  MEDIA_UPLOADED: 'media_uploaded',
  READY_FOR_SCHEDULE: 'ready_for_schedule',
  RENDER_READY: 'render_ready',
  RENDER_FAILED: 'render_failed',
  SCHEDULED: 'scheduled',
  UPLOAD_FAILED: 'upload_failed',
} as const satisfies Record<string, CreatorLifecycleStateExt>;

/**
 * Allowed transitions for attachment-required rows.
 *   awaiting_media_upload → media_uploaded | upload_failed
 *   upload_failed         → media_uploaded | upload_failed (retry)
 *   media_uploaded        → ready_for_schedule | media_uploaded (re-upload) | upload_failed (re-upload fails)
 *   ready_for_schedule    → scheduled | media_uploaded (re-upload) | upload_failed (re-upload fails)
 *   scheduled             → terminal (no rescheduling logic in this PR)
 *
 * Allowed transitions for autonomous rows (kept for completeness — the
 * runtime drives these):
 *   render_ready  → scheduled
 *   render_failed → render_ready (retry)
 */
const TRANSITIONS: Record<CreatorLifecycleStateExt, ReadonlyArray<CreatorLifecycleStateExt>> = {
  awaiting_media_upload: ['media_uploaded', 'upload_failed', 'awaiting_media_upload'],
  upload_failed: ['media_uploaded', 'upload_failed'],
  media_uploaded: ['ready_for_schedule', 'media_uploaded', 'upload_failed'],
  ready_for_schedule: ['scheduled', 'media_uploaded', 'upload_failed'],
  // `scheduled` is no longer terminal — reschedule / replace-media /
  // publish-time re-validation can move it forward. The allowed exits:
  //   scheduled → media_uploaded   (replace-media upload)
  //   scheduled → ready_for_schedule (retime only, no media change)
  //   scheduled → upload_failed    (publish-time re-validation failed)
  // The row's `scheduled_post_id` history is preserved on the lifecycle
  // history entry so the audit trail still threads through.
  scheduled: ['media_uploaded', 'ready_for_schedule', 'upload_failed'],
  render_ready: ['scheduled', 'render_failed'],
  render_failed: ['render_ready', 'render_failed'],
};

export function canTransition(from: CreatorLifecycleStateExt | undefined | null, to: CreatorLifecycleStateExt): boolean {
  if (!from) {
    // Initial entry into the lifecycle. The runtime stamps the first state
    // unconditionally; only the FROM-the-known-state branch enforces
    // transitions.
    return true;
  }
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export class CreatorLifecycleTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'CREATOR_LIFECYCLE_TRANSITION_INVALID';
  readonly from: CreatorLifecycleStateExt | null;
  readonly to: CreatorLifecycleStateExt;

  constructor(from: CreatorLifecycleStateExt | null, to: CreatorLifecycleStateExt) {
    super(`Invalid creator lifecycle transition: ${from ?? 'null'} → ${to}`);
    this.name = 'CreatorLifecycleTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown when a caller's `expected_revision` doesn't match the row's
 * actual revision. The client should refresh the row state and retry.
 *
 * The "revision" is just `content.creator_lifecycle_history.length` —
 * monotonically increasing as every successful transition appends one
 * entry. The token never needs explicit persistence; it's derived.
 */
export class CreatorConcurrencyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'CONCURRENT_UPLOAD_CONFLICT';
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`Concurrent upload conflict: expected revision ${expected}, actual ${actual}.`);
    this.name = 'CreatorConcurrencyConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The row's current revision = length of `creator_lifecycle_history`.
 * A brand-new row (no transitions yet) is revision 0.
 */
export function readLifecycleRevision(content: Record<string, unknown> | null | undefined): number {
  if (!content || typeof content !== 'object') return 0;
  const history = (content as Record<string, unknown>).creator_lifecycle_history;
  return Array.isArray(history) ? history.length : 0;
}

export function assertTransition(
  from: CreatorLifecycleStateExt | undefined | null,
  to: CreatorLifecycleStateExt,
): void {
  if (!canTransition(from, to)) {
    throw new CreatorLifecycleTransitionError(from ?? null, to);
  }
}

/**
 * Extract the current per-row lifecycle state from a row's `content` JSON,
 * preferring the new `creator_lifecycle_state` field and falling back to
 * legacy `content_status` semantics so older rows keep working.
 */
export function readLifecycleState(content: Record<string, unknown> | null | undefined): CreatorLifecycleStateExt | null {
  if (!content || typeof content !== 'object') return null;
  const direct = content.creator_lifecycle_state;
  if (typeof direct === 'string') {
    const normalized = direct.trim().toLowerCase();
    if (isLifecycleState(normalized)) return normalized;
  }
  const status = content.content_status;
  if (typeof status === 'string') {
    const normalized = status.trim().toLowerCase();
    if (isLifecycleState(normalized)) return normalized;
    if (normalized === 'guidance_ready') return 'awaiting_media_upload';
  }
  return null;
}

function isLifecycleState(value: string): value is CreatorLifecycleStateExt {
  return value === 'awaiting_media_upload' ||
    value === 'media_uploaded' ||
    value === 'ready_for_schedule' ||
    value === 'render_ready' ||
    value === 'render_failed' ||
    value === 'scheduled' ||
    value === 'upload_failed';
}

export type LifecycleTransitionPayload = {
  /** Additional `content` JSON fields to persist alongside the new state. */
  contentPatch?: Record<string, unknown>;
  /** Optional explicit timestamp; defaults to now. */
  occurredAt?: string;
  /** Free-text reason captured into the audit trail. */
  reason?: string;
  /**
   * Optional optimistic-concurrency token. If provided, the transition
   * is rejected with {@link CreatorConcurrencyConflictError} when the
   * row's current revision (history length) doesn't match.
   *
   * Use this when a long-running upload could collide with a concurrent
   * reschedule / re-upload from a second tab.
   */
  expectedRevision?: number;
};

export type LifecycleTransitionResult = {
  from: CreatorLifecycleStateExt | null;
  to: CreatorLifecycleStateExt;
  /** The updated `content` JSON object (caller persists). */
  content: Record<string, unknown>;
  /** Mirror value to write to the legacy `content_status` DB column. */
  contentStatus: string;
  /** The audit-trail entry appended to `content.creator_lifecycle_history`. */
  historyEntry: {
    from: CreatorLifecycleStateExt | null;
    to: CreatorLifecycleStateExt;
    at: string;
    reason?: string;
  };
};

/**
 * Apply a transition to a row's JSON content. Validates legality first.
 * Returns the updated content + the mirror status; the caller writes both
 * to the DB.
 *
 * - Appends an audit entry to `content.creator_lifecycle_history` (capped
 *   at 24 entries so a runaway re-upload loop doesn't bloat the row).
 * - Mirrors `creator_lifecycle_state` and `content_status` to the new
 *   value so both readers stay in sync.
 */
export function applyTransition(
  currentContent: Record<string, unknown> | null | undefined,
  to: CreatorLifecycleStateExt,
  payload: LifecycleTransitionPayload = {},
): LifecycleTransitionResult {
  const from = readLifecycleState(currentContent);
  if (typeof payload.expectedRevision === 'number') {
    const actualRevision = readLifecycleRevision(currentContent);
    if (payload.expectedRevision !== actualRevision) {
      throw new CreatorConcurrencyConflictError(payload.expectedRevision, actualRevision);
    }
  }
  assertTransition(from, to);
  const baseContent = (currentContent && typeof currentContent === 'object') ? { ...currentContent } : {};
  const occurredAt = payload.occurredAt ?? new Date().toISOString();
  const historyEntry = {
    from,
    to,
    at: occurredAt,
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
  const existingHistory = Array.isArray((baseContent as Record<string, unknown>).creator_lifecycle_history)
    ? ((baseContent as Record<string, unknown>).creator_lifecycle_history as Array<Record<string, unknown>>)
    : [];
  const updatedContent: Record<string, unknown> = {
    ...baseContent,
    ...(payload.contentPatch ?? {}),
    creator_lifecycle_state: to,
    content_status: to,
    creator_lifecycle_history: [...existingHistory, historyEntry].slice(-24),
  };
  return {
    from,
    to,
    content: updatedContent,
    contentStatus: to,
    historyEntry,
  };
}
