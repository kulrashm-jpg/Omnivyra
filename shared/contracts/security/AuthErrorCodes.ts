/**
 * Canonical auth error codes — shared by server endpoints and client
 * consumers.
 *
 * Why this enum exists
 * ────────────────────
 * Before Phase 2.B hardening, server endpoints encoded auth failure as a
 * raw 401/403 with an ad-hoc error string, and CompanyContext treated EVERY
 * 401 from `/api/company-profile` as a "ghost session" → forced sign-out →
 * redirect to `/login`. The result was a silent login loop whenever the
 * real failure was anything OTHER than an actually-invalid token (schema
 * mismatch, missing user row, lifecycle gate, transient DB outage).
 *
 * The fix is to make the protocol explicit: every auth-relevant API
 * response carries one of these codes in `body.code`, and the client
 * decides what to do based on the code — NOT the HTTP status alone.
 *
 * Client behavior matrix
 * ──────────────────────
 *   Code                    | HTTP | Client action
 *   ────────────────────── | ──── | ─────────────────────────────────────────
 *   INVALID_SESSION         | 401  | signOut() + redirect to /login
 *   ACCOUNT_DELETED         | 403  | signOut() + redirect /login?error=account_deleted
 *   ACCOUNT_DISABLED        | 403  | signOut() + redirect with explanation
 *   USER_NOT_FOUND          | 401  | show visible error, do NOT signOut
 *   USER_INVITED            | 401  | show "complete activation" UI, do NOT signOut
 *   SCHEMA_MISMATCH         | 503  | show transient error, do NOT signOut, allow retry
 *   PROFILE_LOAD_FAILED     | 500  | show transient error, do NOT signOut, allow retry
 *
 * Only the first three are session-fatal. Everything else preserves the
 * session and surfaces a visible state the user can act on.
 */

export const AUTH_ERROR_CODE = {
  /** Token rejected, revoked, expired, or no token presented. Re-auth required. */
  INVALID_SESSION:    'INVALID_SESSION',
  /** Account is soft-deleted. Permanent; user must contact support. */
  ACCOUNT_DELETED:    'ACCOUNT_DELETED',
  /** Account is suspended (reversible). User cannot proceed until reinstated. */
  ACCOUNT_DISABLED:   'ACCOUNT_DISABLED',
  /** Token valid but no public.users row for this identity (orphan auth). */
  USER_NOT_FOUND:     'USER_NOT_FOUND',
  /** User is in the 'invited' lifecycle state and has not yet activated. */
  USER_INVITED:       'USER_INVITED',
  /** DB schema lacks a column the resolver requires (missing migration). */
  SCHEMA_MISMATCH:    'SCHEMA_MISMATCH',
  /** Generic non-auth load failure (DB outage, query timeout, etc.). */
  PROFILE_LOAD_FAILED:'PROFILE_LOAD_FAILED',
} as const;

export type AuthErrorCode = typeof AUTH_ERROR_CODE[keyof typeof AUTH_ERROR_CODE];

/**
 * Legacy compatibility — historical responses used `code: 'AUTH_001'` for
 * ACCOUNT_DELETED. Treat both forms as the same logical code on the client
 * so existing clients keep working through the rollout.
 */
export const LEGACY_AUTH_CODE_ALIASES: Record<string, AuthErrorCode> = {
  AUTH_001: AUTH_ERROR_CODE.ACCOUNT_DELETED,
};

export interface AuthErrorPayload {
  error: string;
  code:  AuthErrorCode;
  /** Optional human-readable explanation safe to surface in the UI. */
  details?: string;
}

/**
 * Codes that REQUIRE the client to sign out and redirect. Anything not in
 * this set MUST preserve the session and surface a retryable error state.
 *
 * This is the single source of truth — both server (when deciding HTTP
 * status) and client (when deciding signOut behavior) should reference it.
 */
export const SESSION_FATAL_AUTH_CODES: ReadonlySet<AuthErrorCode> = new Set([
  AUTH_ERROR_CODE.INVALID_SESSION,
  AUTH_ERROR_CODE.ACCOUNT_DELETED,
  AUTH_ERROR_CODE.ACCOUNT_DISABLED,
]);

export function isSessionFatalCode(code: string | null | undefined): boolean {
  if (!code) return false;
  if ((SESSION_FATAL_AUTH_CODES as ReadonlySet<string>).has(code)) return true;
  const resolved = LEGACY_AUTH_CODE_ALIASES[code];
  return resolved ? SESSION_FATAL_AUTH_CODES.has(resolved) : false;
}

/** Resolve a legacy/canonical code to its canonical form, or return null. */
export function normalizeAuthCode(code: string | null | undefined): AuthErrorCode | null {
  if (!code) return null;
  if ((Object.values(AUTH_ERROR_CODE) as string[]).includes(code)) {
    return code as AuthErrorCode;
  }
  return LEGACY_AUTH_CODE_ALIASES[code] ?? null;
}
