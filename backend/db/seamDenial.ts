/**
 * seamDenial - the ONE way a request handler answers a TenantSeamError (e9 + 05, 2026-11-14).
 *
 *  - A RETRYABLE seam error (TenantSeamError.retryable: a parent row that could not be READ, e.g. a statement
 *    timeout) -> 503 + Retry-After with a plain "try again" body. It is not a denial: the tenant check could not run.
 *  - Any other seam error (absent / foreign / mismatched parent, missing context) -> the route's own uniform denial
 *    (the status + body the route already used, typically 404 "... not found" or its 403).
 *
 * The body never carries the parent id or the underlying error. NOT an existence oracle: the retryable path fires
 * on a READ FAILURE before ownership is known, so it answers identically for an owned and a foreign id.
 *
 * scripts / backend/tests/unit/seamDenialStructural.test.ts pins that every pages/api catch of TenantSeamError goes
 * through here (no local copies), with reviewed exemptions only.
 */
import type { NextApiResponse } from 'next';
import type { TenantSeamError } from './tenantTable';

export const SEAM_RETRY_AFTER_SECONDS = 5;
export const SEAM_RETRY_BODY = Object.freeze({
  error: "We couldn't load this right now. Please try again.",
  code: 'TEMPORARILY_UNAVAILABLE',
});

export function seamDenial(
  res: NextApiResponse,
  err: TenantSeamError,
  denyStatus: number,
  denyBody: Record<string, unknown>,
) {
  if (err.retryable) {
    res.setHeader('Retry-After', String(SEAM_RETRY_AFTER_SECONDS));
    return res.status(503).json(SEAM_RETRY_BODY);
  }
  return res.status(denyStatus).json(denyBody);
}
