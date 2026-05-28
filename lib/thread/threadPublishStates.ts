/**
 * Phase 1B.2.1 — Thread publish state model.
 *
 * Canonical TypeScript representation of `scheduled_posts.status` values used
 * by the thread publish orchestrator. Pure types + pure functions; no I/O.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATE SEMANTICS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * For a multi-row thread (root + N children) under 1B.2 orchestration:
 *
 *   draft       — Dormant. Cron's status='scheduled' filter ignores it.
 *                 Used by:
 *                   - 1B.1A: multi-row root in shadow mode
 *                   - 1B.1A: ALL children at insert time (root-orchestrates-all)
 *
 *   scheduled   — Cron-eligible publish target.
 *                 Used by:
 *                   - Legacy single-row posts (existing)
 *                   - 1B.2: the multi-row ROOT in enforce mode (so cron picks
 *                     it up and delegates to the orchestrator)
 *
 *   publishing  — Currently in-flight inside the orchestrator. Set by the
 *                 orchestrator BEFORE calling the platform adapter. Cron's
 *                 status='scheduled' filter ignores it (no double-execution).
 *                 NEW USE in 1B.2 (the state already existed in chk_status
 *                 but was never written by code).
 *
 *   published   — Successfully published. platform_post_id is set. Terminal.
 *                 (Note: existing code writes 'PUBLISHED' uppercase via
 *                 updateScheduledPostOnPublish — orchestrator will use the
 *                 same casing the existing code uses to avoid surprises.)
 *
 *   failed      — Publish was attempted, platform rejected or threw. Terminal
 *                 unless resume-from-failed is invoked.
 *
 *   cancelled   — Operator-initiated cancellation. Terminal.
 *
 *   blocked     — NEW in 1B.2.1. Downstream sibling of a failed node — the
 *                 orchestrator stopped before reaching this row. Terminal
 *                 unless the upstream failure is resolved + resume invoked,
 *                 at which point this row transitions back to 'publishing'.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VALID TRANSITIONS (orchestrator-managed)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   draft       → publishing (orchestrator picks up child for publish)
 *   draft       → blocked    (orchestrator marks unreached child after a
 *                              sibling failure occurred BEFORE this row was
 *                              processed)
 *   draft       → cancelled  (operator cancels before orchestrator runs)
 *
 *   scheduled   → publishing (orchestrator picks up root)
 *   scheduled   → failed     (orchestrator early-failed before publish)
 *   scheduled   → cancelled  (operator cancels)
 *
 *   publishing  → published  (platform adapter returned success)
 *   publishing  → failed     (platform adapter threw or returned failure)
 *
 *   failed      → publishing (resume-from-failed retry)
 *   blocked     → publishing (resume after upstream re-runs)
 *
 *   published   → (terminal)
 *   cancelled   → (terminal)
 *
 * Any transition not listed above is invalid and `assertCanTransition` throws.
 */

export type ThreadPublishStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export const THREAD_PUBLISH_STATUS_VALUES: readonly ThreadPublishStatus[] = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
  'blocked',
] as const;

/**
 * Terminal statuses produce no further automatic transitions. (They can still
 * be moved by explicit operator action: e.g., failed → publishing via the
 * resume endpoint, or blocked → publishing when the upstream is re-run.)
 *
 * 'published' and 'cancelled' are STRICTLY terminal — the orchestrator never
 * moves them. 'failed' and 'blocked' are terminal under the cron, but the
 * resume path can re-enter them into 'publishing'.
 */
export const STRICTLY_TERMINAL_STATES: ReadonlySet<ThreadPublishStatus> = new Set([
  'published',
  'cancelled',
]);

export const ORCHESTRATOR_TERMINAL_STATES: ReadonlySet<ThreadPublishStatus> = new Set([
  'published',
  'failed',
  'cancelled',
  'blocked',
]);

/**
 * Statuses that the cron's direct scan picks up (`status='scheduled'`). Listed
 * for clarity even though it's a single value — future changes to the cron
 * filter should update this set in lockstep.
 */
export const CRON_ELIGIBLE_STATES: ReadonlySet<ThreadPublishStatus> = new Set([
  'scheduled',
]);

/**
 * Statuses that mean a row is "off-radar" for the cron and the orchestrator
 * should skip them when sweeping children. Useful for the resume endpoint to
 * decide which rows are safely already-published vs. which need retry.
 */
export const DORMANT_STATES: ReadonlySet<ThreadPublishStatus> = new Set([
  'draft',
  'cancelled',
  'blocked',
]);

const TRANSITIONS: Readonly<Record<ThreadPublishStatus, ReadonlySet<ThreadPublishStatus>>> = {
  draft:      new Set(['publishing', 'blocked', 'cancelled']),
  scheduled:  new Set(['publishing', 'failed', 'cancelled']),
  publishing: new Set(['published', 'failed']),
  published:  new Set([]),
  failed:     new Set(['publishing']),
  cancelled:  new Set([]),
  blocked:    new Set(['publishing']),
};

export function isThreadPublishStatus(value: unknown): value is ThreadPublishStatus {
  return typeof value === 'string'
    && (THREAD_PUBLISH_STATUS_VALUES as readonly string[]).includes(value);
}

export function isStrictlyTerminal(s: ThreadPublishStatus): boolean {
  return STRICTLY_TERMINAL_STATES.has(s);
}

export function isOrchestratorTerminal(s: ThreadPublishStatus): boolean {
  return ORCHESTRATOR_TERMINAL_STATES.has(s);
}

export function isCronEligible(s: ThreadPublishStatus): boolean {
  return CRON_ELIGIBLE_STATES.has(s);
}

export function isDormant(s: ThreadPublishStatus): boolean {
  return DORMANT_STATES.has(s);
}

export function canTransition(from: ThreadPublishStatus, to: ThreadPublishStatus): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.has(to);
}

export class InvalidThreadPublishTransitionError extends Error {
  readonly name = 'InvalidThreadPublishTransitionError';
  constructor(
    public readonly from: ThreadPublishStatus,
    public readonly to: ThreadPublishStatus,
  ) {
    super(`Invalid thread publish status transition: ${from} -> ${to}`);
  }
}

export function assertCanTransition(from: ThreadPublishStatus, to: ThreadPublishStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidThreadPublishTransitionError(from, to);
  }
}

/**
 * Convenience: classify the outcome of a thread publish run based on the
 * collected per-node final statuses. Used by the orchestrator to decide what
 * to write to the root row after the sweep completes.
 *
 *   - All nodes 'published'                           → 'published'
 *   - At least one 'failed' AND no 'publishing' left  → 'failed'
 *   - At least one 'publishing' left (unexpected)     → 'publishing' (caller
 *     should investigate; likely orchestrator crashed mid-sweep)
 *   - Mix of 'published' + 'blocked' (no 'failed')    → 'failed' (a sibling
 *     failure caused the blocking; the root is the failure aggregate)
 */
export function classifyThreadOutcome(
  perNodeFinalStatuses: ThreadPublishStatus[],
): ThreadPublishStatus {
  if (perNodeFinalStatuses.length === 0) return 'failed';
  const has = (s: ThreadPublishStatus) => perNodeFinalStatuses.includes(s);
  if (has('publishing')) return 'publishing';
  if (perNodeFinalStatuses.every((s) => s === 'published')) return 'published';
  return 'failed';
}
