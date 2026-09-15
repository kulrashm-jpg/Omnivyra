/**
 * Sliding-window rate limiter for authentication endpoints.
 *
 * Uses Redis MULTI/EXEC for atomicity. All counts are per key (typically
 * per-IP or per-UID) over a rolling time window.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY DECISION RECORD — Redis-unavailable behaviour (revised 3AH-91 SEC-E2)
 * ─────────────────────────────────────────────────────────────────────────
 * Behaviour is now EXPLICIT PER LIMIT (see `RedisFailureMode` and
 * `resolveRedisFailureMode` below):
 *
 *   'fallback' — non-sensitive limits (default): per-process in-memory bucket
 *                with the historical generous cap (50/window). Unchanged.
 *   'strict'   — SENSITIVE limits (`sensitive: true`: login pre-check, OTP,
 *                email-link sends — magic link / reset / signup / resend —,
 *                onboarding credit grant, invites; inherited by every config
 *                spread from LOGIN_LIMIT / EMAIL_LINK_LIMIT): per-process
 *                bucket that enforces the limit's OWN budget (3–10/window),
 *                never the generous cap. Default for sensitive limits.
 *   'closed'   — refuse (429 at the caller). Sensitive limits switch to it
 *                when RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE=closed; any config
 *                may also pin `onRedisFailure: 'closed'`.
 *
 * Why sensitive limits are not fail-closed BY DEFAULT: Redis unavailability
 * here is not hypothetical — the Upstash plan quota has been exhausted in
 * production before, and every command then errors for the rest of the
 * period. Fail-closed by default would turn that into a complete sign-in /
 * sign-up / password-reset outage for every user. 'strict' closes the
 * amplification (a 3/hour limit no longer becomes 50/hour per instance)
 * without that blast radius; 'closed' is the staged escalation for an
 * operator who has confirmed Redis capacity (MANUAL, see docs/security/SEC91_E.md).
 * Residual risk of 'strict': the bucket is per instance, so N serverless
 * instances allow up to N × limit.
 *
 * The original (pre-3AH-91) record follows for context.
 *
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
import { logger } from '../../backend/services/logger';
import { getInstrumentedStandaloneRedisClient } from '../../backend/queue/standaloneRedisClient';
import { recordRawCounter } from '../../backend/observability';

/** AUTH-001R §5 — fail-safe canonical counter alongside the anomaly event. */
function countRateLimitTriggered(prefix: string): void {
  try { recordRawCounter('signup.rate_limit_triggered', 1, { prefix }); } catch { /* fail-safe */ }
}

// ── In-memory fallback limiter ────────────────────────────────────────────────
// Used ONLY when Redis is unavailable (fail-open path).
// Provides a last-resort guardrail — not a replacement for Redis rate limiting.
// Per-process, non-distributed: an attacker who routes requests across multiple
// instances can exceed the cap. Accepted trade-off (Redis down is temporary;
// fail-closed would self-DoS all legitimate users).
interface FallbackBucket { count: number; resetAt: number }
const fallbackMap = new Map<string, FallbackBucket>();
/** Generous per-process cap for NON-sensitive limits — stops flooding, not legitimate bursts. */
const GENEROUS_FALLBACK_CAP = 50;
/** Bound the fallback map during a long outage (one bucket per key). */
const FALLBACK_MAP_MAX = 10_000;

function pruneFallbackMap(now: number): void {
  if (fallbackMap.size < FALLBACK_MAP_MAX) return;
  for (const [k, b] of fallbackMap) {
    if (now >= b.resetAt) fallbackMap.delete(k);
  }
  // Still full of live buckets: drop the oldest insertions (Map preserves order).
  while (fallbackMap.size >= FALLBACK_MAP_MAX) {
    const oldest = fallbackMap.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    fallbackMap.delete(oldest);
  }
}

function fallbackRateLimit(
  key: string,
  config: RateLimitConfig,
  resetAt: number,
  mode: Exclude<RedisFailureMode, 'closed'>,
): RateLimitResult {
  const now = Date.now();
  pruneFallbackMap(now);
  let bucket = fallbackMap.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowSecs * 1_000 };
    fallbackMap.set(key, bucket);
  }
  bucket.count++;
  const cap = mode === 'strict' ? config.limit : GENEROUS_FALLBACK_CAP;
  const allowed = bucket.count <= cap;
  if (!allowed) {
    recordAnomalyEvent('rate_limit_triggered');
    countRateLimitTriggered(config.keyPrefix);
  }
  return { allowed, remaining: Math.max(0, cap - bucket.count), resetAt, bypassed: true, degradedMode: mode };
}

/** Test-only: clear the in-memory fallback buckets. */
export function __resetRateLimitFallbackForTest(): void {
  fallbackMap.clear();
}

// ── Dedicated rate-limit Redis client ─────────────────────────────────────────
// Separate from the BullMQ client so queue and rate-limit failures are isolated.
let _rl: IORedis | null = null;

function getRlRedis(): IORedis {
  if (_rl) return _rl;
  _rl = getInstrumentedStandaloneRedisClient('rate_limit');
  return _rl;
}

/** Disconnect the rate-limit Redis client (for graceful shutdown). */
export function shutdownRateLimitRedis(): void {
  if (_rl) {
    _rl = null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * What a limit does when Redis cannot answer (outage, quota exhausted, aborted
 * transaction). See the decision record at the top of this file.
 */
export type RedisFailureMode = 'fallback' | 'strict' | 'closed';

export interface RateLimitConfig {
  /** Redis key prefix, e.g. "rl:login" */
  keyPrefix: string;
  /** Maximum number of allowed requests in the window */
  limit: number;
  /** Window duration in seconds */
  windowSecs: number;
  /**
   * SEC-E2: a security-sensitive limit (authentication, email-link sends,
   * account creation, credit grant, invites). Sensitive limits never get the
   * generous fallback: 'strict' by default, 'closed' when the operator sets
   * RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE=closed. Inherited by `{ ...LIMIT }`.
   */
  sensitive?: boolean;
  /** Explicit per-limit override of the Redis-unavailable behaviour. */
  onRedisFailure?: RedisFailureMode;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;   // Unix timestamp (seconds) when the window resets
  bypassed: boolean; // true when Redis was unavailable (degraded path)
  /** Which degraded path answered (only when `bypassed`). */
  degradedMode?: RedisFailureMode;
}

const SENSITIVE_MODE_ENV = 'RATE_LIMIT_SENSITIVE_ON_REDIS_FAILURE';

/**
 * Resolve the Redis-unavailable behaviour for a limit. An explicit
 * `onRedisFailure` wins; otherwise sensitive limits are 'strict' unless the
 * operator escalates them to 'closed'; everything else keeps 'fallback'.
 * An unrecognised env value never weakens a sensitive limit.
 */
export function resolveRedisFailureMode(config: RateLimitConfig): RedisFailureMode {
  if (config.onRedisFailure === 'fallback' || config.onRedisFailure === 'strict' || config.onRedisFailure === 'closed') {
    return config.onRedisFailure;
  }
  if (!config.sensitive) return 'fallback';
  const requested = String(process.env[SENSITIVE_MODE_ENV] ?? '').trim().toLowerCase();
  return requested === 'closed' ? 'closed' : 'strict';
}

function degradedResult(key: string, config: RateLimitConfig, resetAt: number): RateLimitResult {
  const mode = resolveRedisFailureMode(config);
  if (mode === 'closed') {
    logger.warn('RATE_LIMIT_FAIL_CLOSED', { prefix: config.keyPrefix });
    recordAnomalyEvent('rate_limit_triggered');
    countRateLimitTriggered(config.keyPrefix);
    return { allowed: false, remaining: 0, resetAt, bypassed: true, degradedMode: 'closed' };
  }
  return fallbackRateLimit(key, config, resetAt, mode);
}

// Exported for W2-3 (Lua AI guard): the batched path must apply the SAME
// admin overrides per keyPrefix as the per-layer JS path.
export async function resolveEffectiveRateLimitConfig(config: RateLimitConfig): Promise<RateLimitConfig> {
  try {
    const { getRateLimitAdminConfig, getRateLimitOverride } = await import('../../backend/services/adminRuntimeConfig');
    await getRateLimitAdminConfig();
    const override = getRateLimitOverride(config.keyPrefix);
    return override
      ? { ...config, limit: override.limit, windowSecs: override.windowSecs }
      : config;
  } catch (error) {
    logger.warn('RATE_LIMIT_ADMIN_CONFIG_UNAVAILABLE', {
      prefix: config.keyPrefix,
      message: error instanceof Error ? error.message : String(error),
    });
    return config;
  }
}

function emitRedisFallbackAnomaly(config: RateLimitConfig, reason: string): void {
  void import('../anomaly/detectionEngine')
    .then(({ detectAnomaly }) => detectAnomaly({
      type:       'redis_fallback_mode',
      entityType: 'system',
      metadata:   { prefix: config.keyPrefix, reason },
    }))
    .catch(() => {});
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
  const effectiveConfig = await resolveEffectiveRateLimitConfig(config);

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
      return degradedResult(key, effectiveConfig, resetAt);
    }

    // results[1] is [error, countBeforeAdd]
    const countBefore = (results[1]?.[1] as number | null) ?? 0;

    if (countBefore >= effectiveConfig.limit) {
      recordAnomalyEvent('rate_limit_triggered');
      countRateLimitTriggered(effectiveConfig.keyPrefix);
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
    // Redis unavailable — the limit's explicit degraded mode decides (see SDR
    // above): generous fallback, strict own-budget fallback, or fail closed.
    logBypass(identifier, config.keyPrefix, err?.message ?? 'redis_error');
    // Emit a CRITICAL anomaly (persisted to system_anomalies, Slack alert sent)
    emitRedisFallbackAnomaly(config, err?.message ?? 'redis_error');
    return degradedResult(key, effectiveConfig, resetAt);
  }
}

function logBypass(identifier: string, prefix: string, reason: string) {
  logger.warn('RATE_LIMIT_REDIS_DOWN', {
    prefix,
    identifier: identifier.slice(0, 64),  // truncate for log safety
    reason,
  });
}

// ── Pre-configured limiters for auth endpoints ────────────────────────────────
// SEC-E2: `sensitive: true` = never the generous Redis-down fallback (see SDR).
// Configs spread from these (`{ ...LOGIN_LIMIT, keyPrefix: ... }`) inherit it.

/** 10 login attempts per IP per 15 minutes */
export const LOGIN_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:login',
  sensitive: true,
  limit: 10,
  windowSecs: 15 * 60,
};

/** 5 OTP sends per UID per hour (prevents SMS spam) */
export const OTP_SEND_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:otp_send',
  sensitive: true,
  limit: 5,
  windowSecs: 60 * 60,
};

/** 10 OTP verification attempts per UID per 15 minutes */
export const OTP_VERIFY_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:otp_verify',
  sensitive: true,
  limit: 10,
  windowSecs: 15 * 60,
};

/** 3 email link sends per IP per hour */
export const EMAIL_LINK_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:email_link',
  sensitive: true,
  limit: 3,
  windowSecs: 60 * 60,
};

/** 5 onboarding completions per IP per hour (credit grant guard) */
export const ONBOARDING_COMPLETE_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:onboarding',
  sensitive: true,
  limit: 5,
  windowSecs: 60 * 60,
};

/**
 * 10 domain canonical-resolutions per IP per minute.
 * Each resolution makes outbound HTTP requests, so this caps the cost AND
 * the SSRF-probing surface a single IP can exercise.
 */
export const DOMAIN_RESOLUTION_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:domain_resolution',
  limit: 10,
  windowSecs: 60,
};

// ── Post-auth UID-based limiters ──────────────────────────────────────────────
// Applied AFTER Supabase token verification, keyed by supabaseUid.
// Prevents rotating-proxy abuse: a single user cannot exceed these regardless
// of how many IP addresses they use.

/** 3 onboarding completions per UID per hour — tighter than the IP limit */
export const ONBOARDING_UID_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:uid:onboarding',
  sensitive: true,
  limit: 3,
  windowSecs: 60 * 60,
};

/** 10 invite sends per UID per hour */
export const INVITE_UID_LIMIT: RateLimitConfig = {
  keyPrefix: 'rl:uid:invite',
  sensitive: true,
  limit: 10,
  windowSecs: 60 * 60,
};
