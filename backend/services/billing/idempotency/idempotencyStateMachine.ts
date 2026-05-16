/**
 * Idempotency State Machine — Phase B
 *
 * Canonical lifecycle states for billing operations + job execution registry
 * rows. Provides:
 *
 *   - Allowed states (canonical taxonomy)
 *   - Terminal-state classification
 *   - Transition validator (rejects invalid transitions)
 *   - Surface-specific mapping (billing_operations / job_execution_registry /
 *     credit_action_approvals all have different DB-level enums; this module
 *     normalizes them to one taxonomy for cross-surface tooling)
 *
 * The state machine does NOT mutate any DB rows itself — it's pure logic
 * the recovery + expiry services consult to decide whether a transition is
 * legal.
 *
 * Critical: the state machine NEVER allows transitions OUT of a terminal
 * state. Once a row is COMPLETED / FAILED / EXPIRED / CANCELLED, it stays
 * there. The DB-level immutability triggers also enforce this; the state
 * machine catches errors earlier.
 */

export const IDEMPOTENCY_STATES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type IdempotencyState = typeof IDEMPOTENCY_STATES[number];

const TERMINAL_STATES = new Set<IdempotencyState>(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']);
const NON_TERMINAL_STATES = new Set<IdempotencyState>(['PENDING', 'IN_PROGRESS']);

export function isTerminal(state: IdempotencyState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isNonTerminal(state: IdempotencyState): boolean {
  return NON_TERMINAL_STATES.has(state);
}

/**
 * Allowed transitions. Any transition not in this map is REJECTED.
 *
 *   PENDING       → IN_PROGRESS | CANCELLED | EXPIRED | FAILED
 *   IN_PROGRESS   → COMPLETED | FAILED | EXPIRED
 *   COMPLETED     → (none) terminal
 *   FAILED        → (none) terminal
 *   EXPIRED       → (none) terminal
 *   CANCELLED     → (none) terminal
 */
const TRANSITIONS: Record<IdempotencyState, ReadonlySet<IdempotencyState>> = {
  PENDING:     new Set(['IN_PROGRESS', 'CANCELLED', 'EXPIRED', 'FAILED']),
  IN_PROGRESS: new Set(['COMPLETED', 'FAILED', 'EXPIRED']),
  COMPLETED:   new Set(),
  FAILED:      new Set(),
  EXPIRED:     new Set(),
  CANCELLED:   new Set(),
};

export interface TransitionResult {
  ok:      boolean;
  reason?: 'TERMINAL_STATE' | 'INVALID_TRANSITION' | 'UNKNOWN_STATE';
}

/** Validate a proposed transition. Pure function; no side effects. */
export function validateTransition(from: IdempotencyState, to: IdempotencyState): TransitionResult {
  if (!IDEMPOTENCY_STATES.includes(from) || !IDEMPOTENCY_STATES.includes(to)) {
    return { ok: false, reason: 'UNKNOWN_STATE' };
  }
  if (isTerminal(from)) {
    return { ok: false, reason: 'TERMINAL_STATE' };
  }
  if (!TRANSITIONS[from].has(to)) {
    return { ok: false, reason: 'INVALID_TRANSITION' };
  }
  return { ok: true };
}

// ── Cross-surface state mappers ─────────────────────────────────────────────

/**
 * `billing_operations.status` → canonical idempotency state.
 *
 *   initiated|held|executed  → IN_PROGRESS
 *   confirmed                → COMPLETED
 *   released                 → CANCELLED  (work didn't charge — treat as cancelled)
 *   insufficient             → FAILED     (work blocked; financial state clean)
 *   duplicate                → COMPLETED  (replay defended; treat the original outcome as complete)
 *   error                    → FAILED
 *
 * Unknown values map to PENDING for safety.
 */
export function billingOperationStatusToState(status: string | null | undefined): IdempotencyState {
  switch (status) {
    case 'initiated':
    case 'held':
    case 'executed':
      return 'IN_PROGRESS';
    case 'confirmed':
    case 'duplicate':
      return 'COMPLETED';
    case 'released':
      return 'CANCELLED';
    case 'insufficient':
    case 'error':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * `job_execution_registry.status` → canonical idempotency state.
 *
 *   reserved|in_progress      → IN_PROGRESS
 *   completed                 → COMPLETED
 *   released|orphan_reaped    → CANCELLED (work didn't complete)
 *   duplicate_blocked         → CANCELLED (replay defended)
 */
export function jobRegistryStatusToState(status: string | null | undefined): IdempotencyState {
  switch (status) {
    case 'reserved':
    case 'in_progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'released':
    case 'orphan_reaped':
    case 'duplicate_blocked':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

/**
 * `credit_action_approvals.status` → canonical idempotency state.
 *
 *   pending     → PENDING
 *   approved    → IN_PROGRESS (signed but underlying action not yet finalized)
 *   executed    → COMPLETED
 *   rejected    → FAILED
 *   cancelled   → CANCELLED
 *   expired     → EXPIRED
 */
export function approvalStatusToState(status: string | null | undefined): IdempotencyState {
  switch (status) {
    case 'pending':   return 'PENDING';
    case 'approved':  return 'IN_PROGRESS';
    case 'executed':  return 'COMPLETED';
    case 'rejected':  return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    case 'expired':   return 'EXPIRED';
    default:          return 'PENDING';
  }
}
