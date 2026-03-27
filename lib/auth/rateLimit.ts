/**
 * Sliding-window rate limiter for authentication endpoints.
 *
 * Uses Redis MULTI/EXEC for atomicity. All counts are per key (typically
 * per-IP or per-UID) over a rolling time window.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY DECISION RECORD — Fail-Open Behaviour
 * ─────────────────────────────────────────────────────────────────────────
 * Decision:  When Redis is unavailable, rate limiting is bypassed (fail-open)
 *            rather than blocking all auth requests (fail-closed).
 *
 * Rationale:
 *   1. Firebase Admin SDK verification is the PRIMARY security gate.
 *      Every request still requires a valid RS256 Firebase ID token.
 *      An attacker cannot bypass token verification even if rate limiting
 *      is down — they still need a signed token from Firebase's servers.
 *
 *   2. Rate limiting is a SECONDARY, abuse-mitigation control, not an
 *      authentication control. Its purpose is to slow automated credential
 *      stuffing and brute-force attempts — neither of which is relevant
 *      when Firebase ID tokens are required (they cannot be brute-forced).
 *
 *   3. Fail-closed during a Redis outage would deny service to ALL
 *      legitimate users — a self-inflicted DoS. The expected blast radius
 *      of a Redis outage (several minutes of unlimited-rate but still
 *      token-authenticated traffic) is vastly smaller than the business
 *      impact of a complete auth blackout.
 *
 *   4. Compensating controls active during Redis unavailability:
 *      - Every bypass is logged as a WARNING (RATE_LIMIT_REDIS_DOWN) with
 *        the request IP and endpoint, enabling anomaly detection.
 *      - Firebase console shows active sessions; revocation still works.
 *      - Supabase DB writes are idempotent — duplicate onboarding calls
 *        cannot grant credits twice (UNIQUE constraint on free_credit_claims).
 *      - PagerDuty/alerting fires on sustained Redis connectivity failures.
 *
 * Residual risk: An attacker who knows Redis is down AND who has a valid
 * Firebase token could make unlimited requests. Accepted — the token
 * requirement is not bypassed.
 *
 * Review date: 2026-09-01  Owner: platform-security
 * ─────────────────────────────────────────────────────────────────────────
 */

import IORedis from 'ioredis';
import { recordAnomalyEvent } from './anomalyDetector';
import { detectAnomaly } from '../anomaly/detectionEngine';
import { createInstrumentedClient } from '../redis/instrumentation';
import { getRateLimitAdminConfig, getRateLimitOverride } from '../../backend/services/adminRuntimeConfig';

// ── In-memory fallback limiter ────────────────────────────────────────────────
// Used ONLY when Redis is unavailable (fail-open path).
// Provides a last-resort guardrail — not a replacement for Redis rate limiting.
// Per-process, non-distributed: an attacker who routes requests across multiple
// instances can exceed the cap. Accepted trade-off (Redis down is temporary;
// fail-closed would self-DoS all legitimate users).
interface FallbackBucket { count: number; resetAt: number }
const fallbackMap = new Map<string, FallbackBucket>();

function fallbackRateLimit(key: string, config: RateLimitConfig, resetAt: number): RateLimitResult {
  const now = Date.now();
  let bucket = fallbackMap.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowSecs * 1_000 };
    fallbackMap.set(key, bucket);
  }
  bucket.count++;
  const allowed = bucket.count <= 50; // generous cap — stops flooding, not legitimate bursts
  if (!allowed) recordAnomalyEvent('rate_limit_triggered');
  return { allowed, remaining: Math.max(0, 50 - bucket.count), resetAt, bypassed: true };
}

// ── Dedicated rate-limit Redis client ─────────────────────────────────────────
// Separate from the BullMQ client so queue and rate-limit failures are isolated.
let _rl: IORedis | null = null;

function getRlRedis(): IORedis {
  if (_rl) return _rl;
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const raw = new IORedis(url, {
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,         // fail fast; rate limiting is non-critical
    connectTimeout: 1_000,           // 1 s connect timeout
    commandTimeout: 500,             // 500 ms per command
    lazyConnect: true,
  });
  raw.on('error', () => {
    // Suppress unhandled error events — failures are handled per-call below
  });
  _rl = createInstrumentedClient(raw, 'rate_limit') as IORedis;
  return _rl;
}

/** Disconnect the rate-limit Redis client (for graceful shutdown). */
export function shutdownRateLimitRedis(): void {
  if (_rl) {
    _rl.quit().catch(() => {});
    _rl = null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Redis key prefix, e.g. "rl:login" */
  keyPrefix: string;
  /** Maximum number of allowed requests in the window */
  limit: number;
  /** Window duration in seconds */
  windowSecs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;   // Unix timestamp (seconds) when the window resets
  bypassed: boolean; // true when Redis was unavailable (fail-open path)
}

// ── Sliding window implementation (Redis MULTI/EXEC) ─────────────────────────

/**
 * Check and increment the rate limit counter for `key`.
 *
 * Algorithm: Redis sorted set, score = request timestamp (ms).
 *   1. Remove entries older than the window.
 *   2. Count remaining entries.
 *   3. Add this request with current timestamp as score.
 *   4. Set expiry on the key.
 *
 * All 4 steps are executed in a single MULTI/EXEC pipeline for atomicity.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  // Warm the admin-config cache (no-op if already fresh); then apply override
  await getRateLimitAdminConfig();
  const override = getRateLimitOverride(config.keyPrefix);
  const effectiveConfig = override
    ? { ...config, limit: override.limit, windowSecs: override.windowSecs }
    : config;

  const redis = getRlRedis();
  const key = `${effectiveConfig.keyPrefix}:${identifier}`;
  const now = Date.now();
  const windowStart = now - effectiveConfig.windowSecs * 1_000;
  const resetAt = Math.ceil((now + effectiveConfig.windowSecs * 1_000) / 1_000); // rough window reset

  try {
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, '-inf', windowStart);            // 1. prune old entries
    pipeline.zcard(key);                                             // 2. count
    pipeline.zadd(key, now, `${now}-${Math.random()}`);             // 3. record this request
    pipeline.expire(key, effectiveConfig.windowSecs + 10);          // 4. set TTL

    const results = await pipeline.exec();

    if (!results) {
      // MULTI/EXEC returned null — Redis transaction aborted (e.g. WATCH conflict).
      // Rare; treat same as Redis unavailable — use in-memory fallback.
      logBypass(identifier, config.keyPrefix, 'transaction_aborted');
      return fallbackRateLimit(key, config, resetAt);
    }

    // results[1] is [error, countBeforeAdd]
    const countBefore = (results[1]?.[1] as number | null) ?? 0;

    if (countBefore >= effectiveConfig.limit) {
      recordAnomalyEvent('rate_limit_triggered');
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        bypassed: false,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, effectiveConfig.limit - countBefore - 1),
      resetAt,
      bypassed: false,
    };
  } catch (err: any) {
    // Redis unavailable — fall back to in-memory limiter (see SDR above).
    // Still enforces a generous per-process cap instead of allowing unlimited requests.
    logBypass(identifier, config.keyPrefix, err?.message ?? 'redis_error');
    // Emit a CRITICAL anomaly (persisted to system_anomalies, Slack alert sent)
    void detectAnomaly({
      type:       'redis_fallback_mode',
      entityType: 'system',
      metadata:   { prefix: config.keyPrefix, reason: err?.message ?? 'redis_error' },
    });
    return fallbackRateLimit(key, config, resetAt);
  }
}

function logBypass(identifier: string, prefix: string, reason: string) {
  console.warn(JSON.stringify({
    level: 'WARN',
    event: 'RATE_LIMIT_REDIS_DOWN',
    prefix,
    identifier: identifier.slice(0, 64),  // truncate for log safety
    reason,
    ts: new Date().toISOString(),
  }));
}

// ── Pre-configured limiters for auth endpoints ────────────────────────────────

/** 10 login attempts per IP per 15 minutes */
export const LOGIN_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:login',
  limit: 10,
  windowSecs: 15 * 60,
};

/** 5 OTP sends per UID per hour (prevents SMS spam) */
export const OTP_SEND_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:otp_send',
  limit: 5,
  windowSecs: 60 * 60,
};

/** 10 OTP verification attempts per UID per 15 minutes */
export const OTP_VERIFY_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:otp_verify',
  limit: 10,
  windowSecs: 15 * 60,
};

/** 3 email link sends per IP per hour */
export const EMAIL_LINK_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:email_link',
  limit: 3,
  windowSecs: 60 * 60,
};

/** 5 onboarding completions per IP per hour (credit grant guard) */
export const ONBOARDING_COMPLETE_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:onboarding',
  limit: 5,
  windowSecs: 60 * 60,
};

// ── Post-auth UID-based limiters ──────────────────────────────────────────────
// Applied AFTER Firebase token verification, keyed by firebaseUid.
// Prevents rotating-proxy abuse: a single user cannot exceed these regardless
// of how many IP addresses they use.

/** 3 onboarding completions per UID per hour — tighter than the IP limit */
export const ONBOARDING_UID_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:uid:onboarding',
  limit: 3,
  windowSecs: 60 * 60,
};

/** 10 invite sends per UID per hour */
export const INVITE_UID_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:uid:invite',
  limit: 10,
  windowSecs: 60 * 60,
};
