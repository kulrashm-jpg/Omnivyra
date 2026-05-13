/**
 * authStateMachine — explicit, typed finite-state machine for the
 * browser-side auth lifecycle.
 *
 * Why this exists
 * ───────────────
 * Pre-Phase-2.B, CompanyContext mixed five booleans (`isLoading`,
 * `isAuthenticated`, `authChecked`, `companiesResolved`, in-flight ref)
 * to encode auth lifecycle stage. Cross-products of those booleans
 * defined real states (e.g. "checked + authenticated + companies-resolved
 * + empty-companies" → onboarding redirect), but illegal combinations
 * were syntactically representable and occasionally reached. The
 * Phase 2.B regression hit exactly one of those illegal states.
 *
 * This FSM names every legal state explicitly. Transitions are pure
 * functions; the only way to advance is to fire an event with a known
 * shape. Illegal transitions are no-ops with a structured warn so
 * regressions show up in logs.
 *
 * The FSM does NOT replace CompanyContext — it sits inside it and gives
 * the context's `useReducer`/state-derivation logic a single explicit
 * surface.
 *
 * State diagram (`*` = any state):
 *
 *   initializing ── AUTH_SUCCESS ─────────────────────▶ authenticated
 *   initializing ── AUTH_FAIL_FATAL ──────────────────▶ signed_out
 *   initializing ── AUTH_FAIL_RETRYABLE ──────────────▶ degraded
 *   authenticated ── AUTH_FAIL_FATAL ─────────────────▶ signed_out
 *   authenticated ── AUTH_FAIL_RETRYABLE ─────────────▶ degraded
 *   degraded     ── RETRY ────────────────────────────▶ retrying
 *   retrying     ── AUTH_SUCCESS ─────────────────────▶ authenticated
 *   retrying     ── AUTH_FAIL_RETRYABLE ──────────────▶ degraded
 *   retrying     ── AUTH_FAIL_FATAL ──────────────────▶ signed_out
 *   retrying     ── RETRY_EXHAUSTED ──────────────────▶ blocked
 *   blocked      ── RETRY ────────────────────────────▶ retrying
 *   blocked      ── AUTH_SUCCESS ─────────────────────▶ authenticated
 *   *            ── SIGN_OUT ─────────────────────────▶ signed_out
 *   *            ── OFFLINE / ONLINE ─────────────────▶ (decorates state, does not transition)
 */

import type { AuthErrorCode } from '../shared/contracts/security/AuthErrorCodes';

export type AuthFsmState =
  | 'initializing'
  | 'authenticated'
  | 'degraded'
  | 'retrying'
  | 'blocked'
  | 'signed_out';

export type AuthFsmEvent =
  | { type: 'AUTH_SUCCESS' }
  | { type: 'AUTH_FAIL_FATAL';     code: AuthErrorCode }
  | { type: 'AUTH_FAIL_RETRYABLE'; code: AuthErrorCode; details?: string }
  | { type: 'RETRY' }
  | { type: 'RETRY_EXHAUSTED' }
  | { type: 'SIGN_OUT'; reason: string }
  | { type: 'OFFLINE' }
  | { type: 'ONLINE' };

export interface AuthFsmContext {
  state:           AuthFsmState;
  /** Last non-fatal error code, when degraded/blocked/retrying. */
  lastErrorCode:   AuthErrorCode | null;
  lastErrorDetails: string | null;
  /** Consecutive retry attempts since last AUTH_SUCCESS. */
  retryAttempts:   number;
  /** True iff we've observed an OFFLINE event without a subsequent ONLINE. */
  offline:         boolean;
  /** Monotonic counter — every transition increments. Useful for tests. */
  transitionCount: number;
  /** ISO timestamp of the most recent transition. */
  transitionedAt:  string;
}

export const initialAuthFsm = (): AuthFsmContext => ({
  state:           'initializing',
  lastErrorCode:   null,
  lastErrorDetails: null,
  retryAttempts:   0,
  offline:         false,
  transitionCount: 0,
  transitionedAt:  new Date().toISOString(),
});

export interface TransitionResult {
  next:           AuthFsmContext;
  changed:        boolean;
  /** Set when an illegal/no-op event was fired so callers can log it. */
  illegal:        { event: AuthFsmEvent['type']; fromState: AuthFsmState } | null;
}

export function transitionAuthFsm(
  current: AuthFsmContext,
  event: AuthFsmEvent,
): TransitionResult {
  const now = new Date().toISOString();
  // Universal events first.
  if (event.type === 'SIGN_OUT') {
    if (current.state === 'signed_out') return same(current);
    return changed(current, {
      state:           'signed_out',
      lastErrorCode:   null,
      lastErrorDetails: null,
      retryAttempts:   0,
      transitionedAt:  now,
    });
  }
  if (event.type === 'OFFLINE') {
    if (current.offline) return same(current);
    return changed(current, { offline: true, transitionedAt: now });
  }
  if (event.type === 'ONLINE') {
    if (!current.offline) return same(current);
    return changed(current, { offline: false, transitionedAt: now });
  }

  switch (current.state) {
    case 'initializing':
      if (event.type === 'AUTH_SUCCESS') {
        return changed(current, {
          state:           'authenticated',
          lastErrorCode:   null,
          lastErrorDetails: null,
          retryAttempts:   0,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_FATAL') {
        return changed(current, {
          state:           'signed_out',
          lastErrorCode:   event.code,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_RETRYABLE') {
        return changed(current, {
          state:           'degraded',
          lastErrorCode:   event.code,
          lastErrorDetails: event.details ?? null,
          transitionedAt:  now,
        });
      }
      break;

    case 'authenticated':
      if (event.type === 'AUTH_FAIL_FATAL') {
        return changed(current, {
          state:           'signed_out',
          lastErrorCode:   event.code,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_RETRYABLE') {
        return changed(current, {
          state:           'degraded',
          lastErrorCode:   event.code,
          lastErrorDetails: event.details ?? null,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_SUCCESS') return same(current); // idempotent
      break;

    case 'degraded':
      if (event.type === 'RETRY') {
        return changed(current, {
          state:           'retrying',
          retryAttempts:   current.retryAttempts + 1,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_SUCCESS') {
        return changed(current, {
          state:           'authenticated',
          lastErrorCode:   null,
          lastErrorDetails: null,
          retryAttempts:   0,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_FATAL') {
        return changed(current, {
          state:           'signed_out',
          lastErrorCode:   event.code,
          transitionedAt:  now,
        });
      }
      break;

    case 'retrying':
      if (event.type === 'AUTH_SUCCESS') {
        return changed(current, {
          state:           'authenticated',
          lastErrorCode:   null,
          lastErrorDetails: null,
          retryAttempts:   0,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_RETRYABLE') {
        return changed(current, {
          state:           'degraded',
          lastErrorCode:   event.code,
          lastErrorDetails: event.details ?? null,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_FAIL_FATAL') {
        return changed(current, {
          state:           'signed_out',
          lastErrorCode:   event.code,
          transitionedAt:  now,
        });
      }
      if (event.type === 'RETRY_EXHAUSTED') {
        return changed(current, {
          state:           'blocked',
          transitionedAt:  now,
        });
      }
      break;

    case 'blocked':
      if (event.type === 'RETRY') {
        return changed(current, {
          state:           'retrying',
          retryAttempts:   current.retryAttempts + 1,
          transitionedAt:  now,
        });
      }
      if (event.type === 'AUTH_SUCCESS') {
        return changed(current, {
          state:           'authenticated',
          lastErrorCode:   null,
          lastErrorDetails: null,
          retryAttempts:   0,
          transitionedAt:  now,
        });
      }
      break;

    case 'signed_out':
      if (event.type === 'AUTH_SUCCESS') {
        return changed(current, {
          state:           'authenticated',
          lastErrorCode:   null,
          lastErrorDetails: null,
          retryAttempts:   0,
          transitionedAt:  now,
        });
      }
      break;
  }

  // No matching legal transition → no-op, but report.
  return {
    next:    current,
    changed: false,
    illegal: { event: event.type, fromState: current.state },
  };
}

function changed(current: AuthFsmContext, patch: Partial<AuthFsmContext>): TransitionResult {
  return {
    next: {
      ...current,
      ...patch,
      transitionCount: current.transitionCount + 1,
    },
    changed: true,
    illegal: null,
  };
}

function same(current: AuthFsmContext): TransitionResult {
  return { next: current, changed: false, illegal: null };
}
