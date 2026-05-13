/**
 * sendAuthError — server-side helper that builds + emits a typed auth
 * error envelope with the correct HTTP status.
 *
 * Every auth-relevant endpoint MUST go through this helper rather than
 * hand-crafting `res.status(401).json({ error: '...' })`. The previous
 * shape (raw `error: string`, sometimes plus `code`, sometimes not) is
 * what made the Phase 2.B login loop so debuggable-only-in-hindsight:
 * the client couldn't tell "session ended" from "schema missing" from
 * "user awaiting activation" from the response payload.
 *
 * Usage
 * ─────
 *   import { sendAuthError } from '../../../backend/services/sendAuthError';
 *   import { AUTH_ERROR_CODE } from '../../../shared/contracts/security';
 *
 *   if (error === 'ACCOUNT_DELETED') {
 *     return sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
 *   }
 *   return sendAuthError(res, AUTH_ERROR_CODE.USER_NOT_FOUND, {
 *     details: 'Sync your account by signing in again.',
 *   });
 */

import type { NextApiResponse } from 'next';
import {
  AUTH_ERROR_REGISTRY,
  getAuthErrorContract,
} from '../../shared/contracts/security/AuthErrorRegistry';
import {
  buildAuthErrorResponse,
  type AuthErrorResponse,
} from '../../shared/contracts/security/AuthErrorResponse';
import {
  AUTH_ERROR_CODE,
  type AuthErrorCode,
} from '../../shared/contracts/security/AuthErrorCodes';
import { logger } from './logger';
import { incrementAuthMetric } from './authMetrics';

export interface SendAuthErrorInput {
  details?:      string;
  retryAfterMs?: number;
  errorOverride?: string;
  /**
   * Allow the caller to override the HTTP status the registry would
   * otherwise dictate. Used sparingly — e.g. `/api/auth/login` returns
   * 400 for INVALID_SESSION-class issues during pre-auth checks.
   */
  statusOverride?: number;
}

/**
 * Build + write the envelope, emit a structured log event, and bump the
 * matching metrics counter. Returns the response for chaining.
 */
export function sendAuthError(
  res: NextApiResponse,
  code: AuthErrorCode,
  input: SendAuthErrorInput = {},
): NextApiResponse {
  const contract = getAuthErrorContract(code) ?? AUTH_ERROR_REGISTRY[AUTH_ERROR_CODE.INVALID_SESSION];
  const status = input.statusOverride ?? contract.httpStatus;
  const body: AuthErrorResponse = buildAuthErrorResponse({
    code,
    details:       input.details,
    retryAfterMs:  input.retryAfterMs,
    errorOverride: input.errorOverride,
  });

  logger.info('auth_error_emitted', {
    code,
    category:    contract.category,
    fatal:       contract.fatal,
    retryable:   contract.retryable,
    http_status: status,
  });
  incrementAuthMetric('auth_error_emitted', { code, category: contract.category });

  res.status(status).json(body);
  return res;
}
