/**
 * Creator Rendering — Phase-9 lifecycle contracts (PURE TYPES + data).
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation only. No runtime, no DB, no queue, no providers.
 *
 * This is the canonical render FSM designed in Step 14. Terminal states
 * are frozen (monotonic) — the actual guard is enforced later in the DB
 * layer (mirroring job_execution_registry); here we only model the
 * vocabulary + the legal transition graph as immutable data so future
 * runtime code derives transitions from ONE place, never ad-hoc.
 */

/** Canonical render lifecycle states. */
export type RenderLifecycleState =
  | 'queued'
  | 'preparing'
  | 'rendering'
  | 'processing'
  | 'moderation'
  | 'approval_ready'
  | 'completed'
  | 'attached'              // attached_to_workspace (render_envelope updated)
  | 'scheduling_ready'      // read-only precondition for the scheduler lane
  // ── retry / recovery ──────────────────────────────────────────────────
  | 'retry_scheduled'
  | 'failover_pending'
  | 'handed_to_human'       // bridge → existing Step-9 human-production lane
  // ── terminal: failed ──────────────────────────────────────────────────
  | 'failed_render'
  | 'failed_moderation_pre'
  | 'failed_moderation_post'
  | 'failed_provider_exhausted'
  | 'failed_timeout'
  // ── terminal: cancelled ───────────────────────────────────────────────
  | 'cancelled_by_user'
  | 'cancelled_superseded'
  | 'cancelled_quota';

/** Terminal states never transition out (frozen — audit-evidential). */
export const RENDER_TERMINAL_STATES = [
  'scheduling_ready',
  'failed_render',
  'failed_moderation_pre',
  'failed_moderation_post',
  'failed_provider_exhausted',
  'failed_timeout',
  'cancelled_by_user',
  'cancelled_superseded',
  'cancelled_quota',
] as const;

export type RenderTerminalState = (typeof RENDER_TERMINAL_STATES)[number];

export function isRenderTerminal(s: RenderLifecycleState): boolean {
  return (RENDER_TERMINAL_STATES as readonly string[]).includes(s);
}

/**
 * Legal forward transitions. Immutable data (frozen) — future runtime
 * MUST derive moves from here, never hardcode. Empty array = terminal.
 * `handed_to_human` deliberately routes OUT of rendering into the
 * Step-9 lane (not a render-terminal — the workspace task continues).
 */
export const RENDER_LEGAL_TRANSITIONS: Readonly<
  Record<RenderLifecycleState, ReadonlyArray<RenderLifecycleState>>
> = Object.freeze({
  queued: ['preparing', 'cancelled_by_user', 'cancelled_quota'],
  preparing: ['rendering', 'failed_moderation_pre', 'retry_scheduled', 'cancelled_by_user', 'handed_to_human'],
  rendering: ['processing', 'failed_render', 'retry_scheduled', 'failover_pending', 'failed_timeout', 'cancelled_by_user'],
  processing: ['moderation', 'failed_render', 'retry_scheduled', 'cancelled_by_user'],
  moderation: ['approval_ready', 'failed_moderation_post', 'cancelled_by_user'],
  approval_ready: ['completed', 'failed_moderation_post', 'cancelled_by_user', 'handed_to_human'],
  completed: ['attached', 'cancelled_superseded'],
  attached: ['scheduling_ready', 'cancelled_superseded'],
  scheduling_ready: [],
  retry_scheduled: ['preparing', 'failed_provider_exhausted', 'cancelled_by_user'],
  failover_pending: ['preparing', 'failed_provider_exhausted', 'cancelled_by_user'],
  handed_to_human: [], // leaves the render FSM; Step-9 lane owns it now
  failed_render: [],
  failed_moderation_pre: [],
  failed_moderation_post: [],
  failed_provider_exhausted: [],
  failed_timeout: [],
  cancelled_by_user: [],
  cancelled_superseded: [],
  cancelled_quota: [],
});

/** Pure predicate — is `to` reachable from `from` in ONE legal step. */
export function isLegalRenderTransition(
  from: RenderLifecycleState,
  to: RenderLifecycleState,
): boolean {
  return (RENDER_LEGAL_TRANSITIONS[from] ?? []).includes(to);
}
