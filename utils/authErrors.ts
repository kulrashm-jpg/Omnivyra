/**
 * Centralized auth error utilities.
 *
 * Server endpoints return typed codes from `AUTH_ERROR_CODE` (see
 * `shared/contracts/security/AuthErrorCodes`). The legacy `AUTH_001` code
 * is preserved as an alias for `ACCOUNT_DELETED` so older fetch call sites
 * continue to work through the rollout.
 *
 * Use these helpers on the client side to decide whether a 401/403 should
 * sign the user out (only INVALID_SESSION / ACCOUNT_DELETED / ACCOUNT_DISABLED)
 * or surface a visible recoverable error.
 */

import {
  AUTH_ERROR_CODE,
  isSessionFatalCode,
  normalizeAuthCode,
  type AuthErrorCode,
} from '../shared/contracts/security/AuthErrorCodes';

export { AUTH_ERROR_CODE, isSessionFatalCode, normalizeAuthCode };
export type { AuthErrorCode };

function readCode(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>).code;
  return typeof raw === 'string' ? raw : null;
}

/** Returns true when an API response signals that the account has been deleted. */
export function isAccountDeleted(res: Response, data: unknown): boolean {
  if (res.status !== 401 && res.status !== 403) return false;
  const normalized = normalizeAuthCode(readCode(data));
  return normalized === AUTH_ERROR_CODE.ACCOUNT_DELETED;
}

/** Returns true when an API response signals an invalid or expired auth token. */
export function isAuthError(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

/**
 * Should the client sign the user out and redirect to /login because of
 * this response? Returns true ONLY for INVALID_SESSION / ACCOUNT_DELETED /
 * ACCOUNT_DISABLED — every other 401/403 (USER_INVITED, USER_NOT_FOUND,
 * SCHEMA_MISMATCH, PROFILE_LOAD_FAILED, raw uncoded responses, transient
 * failures) preserves the session.
 *
 * Raw uncoded 401/403 responses (legacy endpoints not yet emitting codes)
 * are treated as NON-fatal so a stale endpoint can't trigger a forced
 * logout. They surface as a visible error instead.
 */
export function shouldForceSignOut(res: Response, data: unknown): boolean {
  if (res.status !== 401 && res.status !== 403) return false;
  return isSessionFatalCode(readCode(data));
}

/**
 * Returns the canonical AuthErrorCode for a response, or null if the
 * server did not emit one. Callers use this to drive visible error UI
 * (e.g. "your account is awaiting activation" vs "service unavailable").
 */
export function getAuthErrorCode(res: Response, data: unknown): AuthErrorCode | null {
  if (res.status < 400) return null;
  return normalizeAuthCode(readCode(data));
}

/**
 * Parses a fetch Response and throws a structured error if the account is deleted.
 * Useful as a one-liner in fetch chains.
 *
 * @example
 *   const data = await res.json();
 *   assertNotDeleted(res, data);          // throws if ACCOUNT_DELETED
 *   processData(data);
 */
export function assertNotDeleted(res: Response, data: unknown): void {
  if (isAccountDeleted(res, data)) {
    throw Object.assign(new Error('ACCOUNT_DELETED'), {
      code: AUTH_ERROR_CODE.ACCOUNT_DELETED,
    });
  }
}
