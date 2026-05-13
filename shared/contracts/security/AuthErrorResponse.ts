/**
 * AuthErrorResponse — the canonical envelope every auth-relevant
 * endpoint returns when a request fails.
 *
 *   {
 *     error:     'human-safe short string',
 *     code:      AuthErrorCode,
 *     category:  AuthErrorCategory,
 *     fatal:     boolean,
 *     retryable: boolean,
 *     details?:  string,     // optional safe-to-display detail
 *     retryAfterMs?: number, // server hint for retry policy
 *   }
 *
 * Server endpoints MUST produce this shape via {@link sendAuthError}, not
 * by hand-crafting JSON. Clients MUST parse with
 * {@link parseAuthErrorResponse} / {@link validateAuthErrorResponse} so
 * any drift is caught at the boundary, not several layers in.
 *
 * `category`, `fatal`, and `retryable` are intentionally redundant with
 * the registry — they let the client make decisions without bundling a
 * full registry copy (e.g. third-party browser plugins, server-to-server
 * consumers, telemetry collectors).
 */

import {
  AUTH_ERROR_CODE,
  normalizeAuthCode,
  type AuthErrorCode,
} from './AuthErrorCodes';
import {
  AUTH_ERROR_REGISTRY,
  getAuthErrorContract,
  type AuthErrorCategory,
} from './AuthErrorRegistry';

export interface AuthErrorResponse {
  error:         string;
  code:          AuthErrorCode;
  category:      AuthErrorCategory;
  fatal:         boolean;
  retryable:     boolean;
  details?:      string;
  retryAfterMs?: number;
}

/**
 * Build the envelope for a given code. Never throws — falls back to
 * INVALID_SESSION metadata if an unknown code is supplied (defensive,
 * since unknown codes can only appear via developer error).
 */
export function buildAuthErrorResponse(input: {
  code:          AuthErrorCode;
  details?:      string;
  retryAfterMs?: number;
  /** Override the user-safe error string. Default = contract.defaultMessage. */
  errorOverride?: string;
}): AuthErrorResponse {
  const contract = getAuthErrorContract(input.code) ?? AUTH_ERROR_REGISTRY[AUTH_ERROR_CODE.INVALID_SESSION];
  return {
    error:         input.errorOverride ?? contract.defaultMessage,
    code:          contract.code,
    category:      contract.category,
    fatal:         contract.fatal,
    retryable:     contract.retryable,
    details:       input.details,
    retryAfterMs:  input.retryAfterMs,
  };
}

/** True if value LOOKS like an AuthErrorResponse envelope. Shape-only. */
export function isAuthErrorResponse(value: unknown): value is AuthErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.error === 'string'
    && typeof v.code === 'string'
    && typeof v.category === 'string'
    && typeof v.fatal === 'boolean'
    && typeof v.retryable === 'boolean'
  );
}

export interface AuthPayloadValidation {
  valid:    boolean;
  problems: string[];
  /** Parsed envelope if valid, else null. */
  payload:  AuthErrorResponse | null;
}

/**
 * Validate a payload against the contract. Used by the client at the
 * fetch boundary AND by API contract tests. Rejects malformed envelopes
 * with a specific list of problems so the caller can render a useful
 * dev-mode warning.
 */
export function validateAuthErrorResponse(value: unknown): AuthPayloadValidation {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return { valid: false, problems: ['payload_is_not_object'], payload: null };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.error !== 'string')     problems.push('error_not_string');
  if (typeof v.code !== 'string')      problems.push('code_not_string');
  if (typeof v.category !== 'string')  problems.push('category_not_string');
  if (typeof v.fatal !== 'boolean')    problems.push('fatal_not_boolean');
  if (typeof v.retryable !== 'boolean') problems.push('retryable_not_boolean');
  if (v.details !== undefined && typeof v.details !== 'string') problems.push('details_not_string_or_undefined');
  if (v.retryAfterMs !== undefined && typeof v.retryAfterMs !== 'number') problems.push('retryAfterMs_not_number_or_undefined');

  if (problems.length > 0) return { valid: false, problems, payload: null };

  const normalized = normalizeAuthCode(v.code as string);
  if (!normalized) {
    problems.push('code_not_in_registry');
    return { valid: false, problems, payload: null };
  }
  const contract = AUTH_ERROR_REGISTRY[normalized];
  // Soft consistency check — warn if server claims a fatality that
  // disagrees with the registry. Not a hard failure, since the server is
  // authoritative, but we surface it so registry/server can be aligned.
  if (contract.fatal !== v.fatal)         problems.push('fatal_disagrees_with_registry');
  if (contract.retryable !== v.retryable) problems.push('retryable_disagrees_with_registry');

  const payload: AuthErrorResponse = {
    error:         v.error as string,
    code:          normalized,
    category:      v.category as AuthErrorCategory,
    fatal:         v.fatal as boolean,
    retryable:     v.retryable as boolean,
    details:       (v.details as string | undefined),
    retryAfterMs:  (v.retryAfterMs as number | undefined),
  };

  return { valid: problems.length === 0, problems, payload };
}

/** Best-effort: parse a server JSON body into an envelope, or null. */
export function parseAuthErrorResponse(value: unknown): AuthErrorResponse | null {
  return validateAuthErrorResponse(value).payload;
}
