/**
 * W4 — per-tenant rate limit for the routes that call SES (register, refresh).
 *
 * SES control-plane quotas are per AWS ACCOUNT, so without this one tenant
 * could throttle identity operations for every tenant. Uses the established
 * Redis limiter (`lib/auth/rateLimit`), keyed by the tenant id — which the
 * routes pass only AFTER `requireCapability` has authorized it, so a caller
 * cannot spend another tenant's budget.
 *
 * FAILS CLOSED. `onRedisFailure: 'closed'` makes an unavailable Redis a
 * refusal (not the generous in-memory fallback), and anything other than an
 * unambiguous answer from Redis — a throw, a malformed result, a degraded
 * answer — is `unavailable`, never a pass.
 *
 * The budget can be tuned by operators through the existing admin rate-limit
 * override for `keyPrefix` (see `resolveEffectiveRateLimitConfig`).
 */
import { checkRateLimit, type RateLimitConfig } from '../../../lib/auth/rateLimit';

/** 20 SES-calling requests (registrations + refreshes) per tenant per hour. */
export const SENDING_DOMAIN_SES_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:tenant:sending_domains_ses',
  limit: 20,
  windowSecs: 60 * 60,
  onRedisFailure: 'closed',
};

export type SesRouteGate =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited'; retryAfterSecs: number }
  | { allowed: false; reason: 'unavailable' };

export async function gateSendingDomainSesCall(organizationId: string, nowMs: () => number = Date.now): Promise<SesRouteGate> {
  if (!organizationId) return { allowed: false, reason: 'unavailable' };
  let rl: Awaited<ReturnType<typeof checkRateLimit>> | null;
  try {
    rl = await checkRateLimit(organizationId, SENDING_DOMAIN_SES_LIMIT);
  } catch {
    return { allowed: false, reason: 'unavailable' };
  }
  // Only an answer Redis actually gave counts; a degraded answer is not one.
  if (!rl || rl.bypassed !== false) return { allowed: false, reason: 'unavailable' };
  if (rl.allowed === true) return { allowed: true };
  if (rl.allowed === false) {
    const resetAt = Number(rl.resetAt);
    const retryAfterSecs = Number.isFinite(resetAt) ? Math.max(1, Math.ceil(resetAt - nowMs() / 1000)) : SENDING_DOMAIN_SES_LIMIT.windowSecs;
    return { allowed: false, reason: 'rate_limited', retryAfterSecs };
  }
  return { allowed: false, reason: 'unavailable' };
}
