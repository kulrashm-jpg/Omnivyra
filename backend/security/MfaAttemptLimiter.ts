/**
 * MfaAttemptLimiter — per-user + per-IP brute-force protection for the
 * factor-verification endpoints (TOTP token, recovery code, passkey login).
 *
 * Why custom (vs. lib/auth/rateLimit): the existing rate limiter is
 * IP-only and uses fixed windows. MFA brute-force protection needs:
 *   - per-user counters (an attacker rotating IPs against one target is
 *     still bounded)
 *   - exponential cooldown (5 fails → 30s, 10 → 5min, 15 → 1h)
 *   - audit-grade visibility (every failure is logged)
 *   - separate buckets per factor (TOTP failures don't lock recovery codes)
 *
 * Storage: in-memory map for prototype. Production should swap to Redis
 * via the same surface — replace the Map with an upstash/ioredis impl
 * and the rest of the codebase is untouched.
 *
 * Key shape:  `<factor>:user:<userId>` and `<factor>:ip:<ip>`
 *
 * Behaviour: on each verify attempt the caller calls `check(...)`; if it
 * returns `{ allowed: false }` the route MUST reject before invoking the
 * actual factor verifier (saving CPU + closing the timing channel that
 * leaks "user exists / factor enrolled"). On a successful verification
 * the caller should call `reset(...)` to clear both counters.
 */

import { logger } from '../services/logger';

export type MfaFactorKind = 'totp' | 'webauthn' | 'recovery_code';

interface BucketState {
  count: number;
  firstFailureAt: number; // epoch ms
  lockedUntil: number;    // epoch ms; 0 = not locked
}

/**
 * Backoff schedule keyed by failure count.
 *   <  5 failures: no lock (free retries — typo / fat-finger tolerance)
 *   >= 5 failures: 30s lock
 *   >= 10 failures: 5 min lock
 *   >= 15 failures: 1 h lock
 *   >= 20 failures: 24 h lock
 *
 * Counter resets after a successful verify OR after 24 h of inactivity.
 */
function lockMsForFailureCount(count: number): number {
  if (count >= 20) return 24 * 60 * 60 * 1000;
  if (count >= 15) return 60 * 60 * 1000;
  if (count >= 10) return 5 * 60 * 1000;
  if (count >= 5)  return 30 * 1000;
  return 0;
}

const COUNTER_RESET_MS = 24 * 60 * 60 * 1000;

const buckets = new Map<string, BucketState>();

function bucketKey(factor: MfaFactorKind, scope: 'user' | 'ip', value: string): string {
  return `${factor}:${scope}:${value}`;
}

function readBucket(key: string): BucketState {
  const existing = buckets.get(key);
  const now = Date.now();
  if (existing && now - existing.firstFailureAt > COUNTER_RESET_MS) {
    // Stale — reset
    buckets.delete(key);
    return { count: 0, firstFailureAt: 0, lockedUntil: 0 };
  }
  return existing ?? { count: 0, firstFailureAt: 0, lockedUntil: 0 };
}

export interface CheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  /** Telemetry — number of consecutive failures recorded for this scope. */
  failureCount?: number;
}

/**
 * Check whether a verification attempt is allowed RIGHT NOW. Call this
 * BEFORE invoking the factor verifier. If it returns allowed=false, the
 * caller MUST short-circuit with 429 — not even running the verifier
 * closes the timing channel and saves CPU on argon2/otplib calls.
 *
 * Both the user bucket and the IP bucket are checked; the more
 * restrictive one wins.
 */
export function check(input: {
  factor: MfaFactorKind;
  userId: string | null;
  ip: string | null;
}): CheckResult {
  const now = Date.now();
  const checks: Array<BucketState> = [];
  if (input.userId) checks.push(readBucket(bucketKey(input.factor, 'user', input.userId)));
  if (input.ip)     checks.push(readBucket(bucketKey(input.factor, 'ip',   input.ip)));

  for (const state of checks) {
    if (state.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000),
        failureCount: state.count,
      };
    }
  }

  return { allowed: true };
}

/**
 * Record one failed verification. Updates both the user and IP buckets
 * (when each is provided) and applies the exponential lockout schedule.
 * Always returns the new combined retry-after if a lock was applied.
 */
export function recordFailure(input: {
  factor: MfaFactorKind;
  userId: string | null;
  ip: string | null;
}): { lockedFor: number } {
  const now = Date.now();
  let maxLockMs = 0;
  const targets: Array<{ key: string; scope: 'user' | 'ip' }> = [];
  if (input.userId) targets.push({ key: bucketKey(input.factor, 'user', input.userId), scope: 'user' });
  if (input.ip)     targets.push({ key: bucketKey(input.factor, 'ip',   input.ip),     scope: 'ip'   });

  for (const t of targets) {
    const cur = readBucket(t.key);
    const next: BucketState = {
      count: cur.count + 1,
      firstFailureAt: cur.firstFailureAt || now,
      lockedUntil: 0,
    };
    const lockMs = lockMsForFailureCount(next.count);
    if (lockMs > 0) {
      next.lockedUntil = now + lockMs;
      maxLockMs = Math.max(maxLockMs, lockMs);
    }
    buckets.set(t.key, next);
    if (lockMs > 0) {
      logger.warn('mfa_brute_force_lock_applied', {
        factor:        input.factor,
        scope:         t.scope,
        consecutive:   next.count,
        lockSeconds:   Math.floor(lockMs / 1000),
      });
    }
  }

  return { lockedFor: Math.ceil(maxLockMs / 1000) };
}

/**
 * Reset both buckets after a successful verify. Without this, every
 * legitimate login would grow the counter until the user hit a lock.
 */
export function reset(input: {
  factor: MfaFactorKind;
  userId: string | null;
  ip: string | null;
}): void {
  if (input.userId) buckets.delete(bucketKey(input.factor, 'user', input.userId));
  if (input.ip)     buckets.delete(bucketKey(input.factor, 'ip',   input.ip));
}

/** Test-only helper. Do NOT call from production paths. */
export function _internalClearAll(): void {
  buckets.clear();
}
