/**
 * P2-D — uniform responses for unauthenticated account-lookup routes
 * (pages/api/auth/magic-link.ts, pages/api/auth/check-user.ts).
 *
 * Owner ruling: there is no CAPTCHA on login/signup, so the rate limiter is the
 * whole defence against account enumeration on these routes. Two things make a
 * lookup route an oracle even when its body is constant:
 *
 *   1. TIMING — a database hit and a miss take different time (the miss path
 *      may run a second query; the hit path may start an email send). Every
 *      response path is therefore padded to AUTH_ENUMERATION_MIN_RESPONSE_MS
 *      measured from request start.
 *   2. REFUSALS — a 429 must be explicit (never a silent drop), and it is
 *      decided BEFORE the account lookup, so it is the same for every address.
 *
 * The clock is injectable so tests do not really sleep.
 */
import { platformWaitUntil } from '../../lib/runtime/keepAlive';

/**
 * Minimum latency of every response from an enumeration-sensitive auth route,
 * measured from request start. Chosen to sit above the slowest normal path
 * (two indexed lookups) so a hit and a miss are indistinguishable by time.
 */
export const AUTH_ENUMERATION_MIN_RESPONSE_MS = 400;

export interface AuthResponseClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: AuthResponseClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

let activeClock: AuthResponseClock = realClock;

export function getAuthResponseClock(): AuthResponseClock {
  return activeClock;
}

/** Test-only: inject a virtual clock (null restores the real one). */
export function __setAuthResponseClockForTest(clock: AuthResponseClock | null): void {
  activeClock = clock ?? realClock;
}

/** Sleep until `minMs` have elapsed since `startedAt` (no-op if already past). */
export async function padToMinimumLatency(
  startedAt: number,
  clock: AuthResponseClock = activeClock,
  minMs: number = AUTH_ENUMERATION_MIN_RESPONSE_MS,
): Promise<void> {
  const remaining = minMs - (clock.now() - startedAt);
  if (remaining > 0) await clock.sleep(remaining);
}

/** Retry-After seconds from a rate-limit result's `resetAt` (unix seconds); at least 1. */
export function retryAfterSeconds(resetAtSecs: number, nowMs: number): number {
  const secs = Math.ceil(resetAtSecs - nowMs / 1000);
  return Number.isFinite(secs) && secs > 0 ? secs : 1;
}

/** The single 429 body both routes return (identical for every address). */
export const AUTH_RATE_LIMITED_BODY = Object.freeze({
  error: 'Too many requests. Please wait and try again later.',
  code: 'RATE_LIMITED',
});

/** magic-link: the ONE success body — returned whether or not an account exists. */
export const MAGIC_LINK_UNIFORM_BODY = Object.freeze({
  ok: true as const,
  message: "If an account exists for this address, we've sent a sign-in link.",
});

/**
 * Run work that must not delay the response (e.g. the magic-link email send,
 * whose latency would otherwise reveal that the account exists). On Vercel the
 * platform waitUntil keeps the lambda alive until it settles; elsewhere (a
 * long-lived `next start` / dev server) the promise simply runs on. `work`
 * must never reject.
 */
export function runDetachedFromResponse(work: Promise<void>): void {
  const waitUntil = platformWaitUntil();
  if (waitUntil) {
    waitUntil(work);
    return;
  }
  void work;
}
