import { getTrustedClientIp } from '../../lib/security/clientIp';

/**
 * SEC91-W2B-3 — the client IP for authentication routes (rate-limit keys, MFA attempt
 * buckets, security-audit rows).
 *
 * The auth routes used to take the FIRST hop of `X-Forwarded-For`, which the client
 * writes. Off Vercel that let a caller pick a fresh rate-limit / MFA bucket per request
 * (or fill a victim's). They now use the platform-trusted address from
 * lib/security/clientIp.ts (SEC-E2): on Vercel `x-real-ip` / `x-vercel-forwarded-for` /
 * the edge-set `x-forwarded-for`; behind another proxy only with TRUSTED_PROXY_HOPS;
 * otherwise the socket peer. On Vercel (production) this is the same client address the
 * old code produced, because the edge overwrites `x-forwarded-for`.
 *
 * NOTE: backend/services/ai/trustedClientIp.ts (SEC-D1) is a second implementation with
 * different inputs (TRUSTED_CLIENT_IP_HEADER, never XFF) and a null result; the two
 * should be consolidated (see docs/security/SEC91_W2B.md).
 */

type RequestLike = Parameters<typeof getTrustedClientIp>[0];

/** Rate-limit key form: the trusted IP, or 'unknown' when nothing parses as an IP. */
export function authRequestIp(req: RequestLike): string {
  return getTrustedClientIp(req);
}

/** Audit / MFA form: the trusted IP, or null when nothing parses as an IP. */
export function authRequestIpOrNull(req: RequestLike): string | null {
  const ip = getTrustedClientIp(req);
  return ip === 'unknown' ? null : ip;
}
