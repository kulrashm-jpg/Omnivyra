/**
 * AuthErrorRegistry — single source of truth for every auth error code's
 * shape, severity, retryability, UX presentation, and analytics mapping.
 *
 * Why this exists
 * ───────────────
 * Phase 2.B introduced typed codes ({@link AUTH_ERROR_CODE}) and a
 * session-fatal set. That fixed the most acute regression (every 401 →
 * signOut), but the metadata was spread across:
 *
 *   - the SESSION_FATAL_AUTH_CODES set (fatality)
 *   - hardcoded HTTP statuses per endpoint
 *   - client-side decision functions (shouldForceSignOut, getAuthErrorCode)
 *   - banner copy maps
 *
 * The registry collapses all of that into one declarative table. Every
 * downstream consumer (server response builder, client signOut decider,
 * banner copy resolver, analytics dispatcher) derives behavior from this
 * file. Add a new code? Add one row here; the rest of the surface picks
 * it up automatically.
 */

import {
  AUTH_ERROR_CODE,
  type AuthErrorCode,
} from './AuthErrorCodes';

/** Coarse categorization — drives analytics segmentation + dashboards. */
export type AuthErrorCategory =
  | 'session'    // token-shaped failure (INVALID_SESSION, …)
  | 'lifecycle' // user lifecycle gate (USER_INVITED, ACCOUNT_DISABLED, …)
  | 'identity'  // identity resolution (USER_NOT_FOUND)
  | 'schema'    // server-side schema drift (SCHEMA_MISMATCH)
  | 'load';     // generic upstream failure (PROFILE_LOAD_FAILED)

/** UI presentation modes — drives banner / page selection. */
export type AuthErrorPresentation =
  | 'redirect_login'  // session ended — sign user out and go to /login
  | 'banner_retry'    // non-fatal — show banner with retry button
  | 'redirect_setup'  // route the user to a specific recovery flow
  | 'banner_blocking'; // banner with no retry (e.g. ACCOUNT_DISABLED)

export interface AuthErrorContract {
  code:           AuthErrorCode;
  category:       AuthErrorCategory;
  /** HTTP status the server SHOULD emit when returning this code. */
  httpStatus:     number;
  /** Forces client to sign out on receipt. */
  fatal:          boolean;
  /** Safe to retry automatically (with backoff). Fatal codes are never retryable. */
  retryable:      boolean;
  /** UX presentation hint. */
  presentation:   AuthErrorPresentation;
  /** Stable analytics event name. */
  analyticsEvent: string;
  /** Human-safe default message — overridable per-call via `details`. */
  defaultMessage: string;
}

export const AUTH_ERROR_REGISTRY: Readonly<Record<AuthErrorCode, AuthErrorContract>> = {
  [AUTH_ERROR_CODE.INVALID_SESSION]: {
    code:           AUTH_ERROR_CODE.INVALID_SESSION,
    category:       'session',
    httpStatus:     401,
    fatal:          true,
    retryable:      false,
    presentation:   'redirect_login',
    analyticsEvent: 'auth.invalid_session',
    defaultMessage: 'Your session has expired. Please sign in again.',
  },
  [AUTH_ERROR_CODE.ACCOUNT_DELETED]: {
    code:           AUTH_ERROR_CODE.ACCOUNT_DELETED,
    category:       'lifecycle',
    httpStatus:     403,
    fatal:          true,
    retryable:      false,
    presentation:   'redirect_login',
    analyticsEvent: 'auth.account_deleted',
    defaultMessage: 'This account has been removed.',
  },
  [AUTH_ERROR_CODE.ACCOUNT_DISABLED]: {
    code:           AUTH_ERROR_CODE.ACCOUNT_DISABLED,
    category:       'lifecycle',
    httpStatus:     403,
    fatal:          true,
    retryable:      false,
    presentation:   'banner_blocking',
    analyticsEvent: 'auth.account_disabled',
    defaultMessage: 'This account is currently suspended. Contact support for assistance.',
  },
  [AUTH_ERROR_CODE.USER_NOT_FOUND]: {
    code:           AUTH_ERROR_CODE.USER_NOT_FOUND,
    category:       'identity',
    httpStatus:     401,
    fatal:          false,
    retryable:      true,
    presentation:   'banner_retry',
    analyticsEvent: 'auth.user_not_found',
    defaultMessage: "We couldn't find your account profile yet. Try again in a moment.",
  },
  [AUTH_ERROR_CODE.USER_INVITED]: {
    code:           AUTH_ERROR_CODE.USER_INVITED,
    category:       'lifecycle',
    httpStatus:     401,
    fatal:          false,
    retryable:      true,
    presentation:   'banner_retry',
    analyticsEvent: 'auth.user_invited',
    defaultMessage: 'Your account is awaiting activation. Sign in again to finish setup.',
  },
  [AUTH_ERROR_CODE.SCHEMA_MISMATCH]: {
    code:           AUTH_ERROR_CODE.SCHEMA_MISMATCH,
    category:       'schema',
    httpStatus:     503,
    fatal:          false,
    retryable:      true,
    presentation:   'banner_retry',
    analyticsEvent: 'auth.schema_mismatch',
    defaultMessage: "Workspace is updating. Please try again in a moment.",
  },
  [AUTH_ERROR_CODE.PROFILE_LOAD_FAILED]: {
    code:           AUTH_ERROR_CODE.PROFILE_LOAD_FAILED,
    category:       'load',
    httpStatus:     500,
    fatal:          false,
    retryable:      true,
    presentation:   'banner_retry',
    analyticsEvent: 'auth.profile_load_failed',
    defaultMessage: "We couldn't load your workspace. Your session is still active — please try again.",
  },
} as const;

/** Lookup — never throws; returns null for unknown codes. */
export function getAuthErrorContract(code: AuthErrorCode | null | undefined): AuthErrorContract | null {
  if (!code) return null;
  return AUTH_ERROR_REGISTRY[code] ?? null;
}

/**
 * Compile-time invariant — guarantees that every code in AUTH_ERROR_CODE
 * has a registry entry. If you add a new code without a row in the
 * registry above, this object literal fails to type-check at build.
 */
const _exhaustiveRegistryCheck: Record<AuthErrorCode, AuthErrorContract> = AUTH_ERROR_REGISTRY;
void _exhaustiveRegistryCheck;
