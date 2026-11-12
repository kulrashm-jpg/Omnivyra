import { ownedDbTable } from '../db/writeOwner';
/**
 * WhatsApp Rate Limiter
 *
 * Two-layer enforcement:
 *   Layer 1 (fast): Redis counter — real-time per phone_number_id
 *   Layer 2 (fallback): DB counter — used when Redis unavailable (Refinement 6)
 *
 * Enforces:
 *   - Per messaging tier limits (1K/10K/100K/∞ per 24h)
 *   - Per-company plan limits
 *   - Per-broadcast chunking strategy (Improvement 4)
 */

import { supabase } from '../db/supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed:   boolean;
  remaining: number;
  tier:      number;
  source:    'redis' | 'db'; // which layer answered
}

export interface ChunkStrategy {
  batch_size:     number;
  delay_ms:       number; // between batches
}

// ── Tier configuration ────────────────────────────────────────────────────────

const TIER_LIMITS: Record<number, number> = {
  1: 1_000,
  2: 10_000,
  3: 100_000,
  4: Infinity,
};

const PLAN_LIMITS: Record<string, number> = {
  free:       100,
  pro:        5_000,
  enterprise: Infinity,
};

// ── Redis layer ───────────────────────────────────────────────────────────────

let redisClient: any = null;

async function getRedis(): Promise<any | null> {
  if (redisClient) return redisClient;
  try {
    const { getSharedRedisClient } = await import('../queue/bullmqClient');
    redisClient = getSharedRedisClient();
    return redisClient;
  } catch {
    return null;
  }
}

/**
 * Whether the shared client can take a command now. It is the BullMQ client
 * (maxRetriesPerRequest null, offline queue, endless reconnect): while it is not
 * connected a command is queued and never rejected, so awaiting it would hang the
 * send until Redis returns and the DB fallback below would never run. Any status
 * other than 'ready' is skipped; a client without a status field is used.
 */
function redisUsable(redis: unknown): boolean {
  const status = (redis as { status?: unknown } | null)?.status;
  return typeof status !== 'string' || status === 'ready';
}

/** Gives a refused reservation back. A failed give-back over-counts (refuses sooner), never over-sends. */
async function redisDecrBy(key: string, count: number): Promise<void> {
  const redis = await getRedis();
  if (!redis || !redisUsable(redis)) return;
  try {
    await redis.decrby(key, count);
  } catch (err) {
    console.warn('[whatsappRateLimiter] refused reservation not given back; the day over-counts (refuses sooner)', {
      key, count, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The TTL is housekeeping, not the reset: the key carries the UTC DATE (wa:usage:<id>:YYYY-MM-DD),
 * so a new day is a new key whatever happens to the TTL. A failed or skipped expire leaks one key
 * per sender per day; it never throttles the next day (05).
 */
async function redisIncrBy(key: string, count: number, ttlSeconds: number): Promise<number | null> {
  const redis = await getRedis();
  if (!redis || !redisUsable(redis)) return null;
  try {
    const newVal = await redis.incrby(key, count);
    if (newVal === count) {
      // First write — set TTL
      await redis.expire(key, ttlSeconds);
    }
    return newVal;
  } catch {
    return null;
  }
}

// ── DB layer (fallback) ───────────────────────────────────────────────────────

/**
 * THE DEFECT THIS CLOSES (C10, 2026-11-11): the fallback used to READ
 * api_provider_accounts.current_usage_day by account_name = <social account id> (the
 * external-API credential table, where no such row ever exists, so usage read as 0)
 * and to INCREMENT through rpc('increment_wa_usage'), a function that exists in no
 * environment, with the error discarded. During a Redis outage every send was
 * allowed: the limit failed OPEN.
 *
 * Now: ONE call to whatsapp_consume_daily_quota, which checks and consumes in a single
 * statement (it writes only when the new total stays within the limit). FAIL CLOSED:
 * an error, a thrown call, or an answer without a boolean `allowed` and a numeric
 * `used` is a refusal - never "allowed" - and is logged at ERROR.
 *
 * AVAILABILITY TRADE (intended): this layer is reached only when Redis is unavailable,
 * so WhatsApp sends now STOP when Redis AND the database quota store are both
 * unavailable, where before they continued unmetered. That is the correct behaviour
 * for a send limit; a refused send logged with FAIL_CLOSED_REASON is this design
 * working, not a defect.
 */
export const FAIL_CLOSED_REASON =
  'fail-closed by design: the WhatsApp daily limit cannot be checked (Redis and the quota store unavailable), so sends stop until it can';
const INT_MAX = 2_147_483_647;

async function dbConsume(
  socialAccountId: string,
  usageDay:        string,
  count:           number,
  limit:           number,
): Promise<{ allowed: boolean; used: number } | null> {
  try {
    const { data, error } = await supabase.rpc('whatsapp_consume_daily_quota', {
      p_social_account_id: socialAccountId,
      p_usage_day:         usageDay,
      p_count:             count,
      p_limit:             limit,
    });
    if (error) {
      console.error('[whatsappRateLimiter] daily quota check failed; send refused (fail closed) - ' + FAIL_CLOSED_REASON, {
        social_account_id: socialAccountId, error: error.message,
      });
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean' || typeof row.used !== 'number') {
      // No answer is not an answer: a missing or malformed row refuses (a blank
      // response can arrive as {error:null} with no data).
      console.error('[whatsappRateLimiter] daily quota check returned no answer; send refused (fail closed) - ' + FAIL_CLOSED_REASON, {
        social_account_id: socialAccountId,
      });
      return null;
    }
    return { allowed: row.allowed, used: row.used };
  } catch (err) {
    console.error('[whatsappRateLimiter] daily quota check threw; send refused (fail closed) - ' + FAIL_CLOSED_REASON, {
      social_account_id: socialAccountId, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Core rate limit check ─────────────────────────────────────────────────────

/**
 * Check and consume rate limit budget.
 * Returns { allowed, remaining, tier, source }.
 * Refinement 6: Redis-first with automatic DB fallback.
 */
export async function checkAndConsume(params: {
  social_account_id: string;
  phone_number_id:   string;
  company_id:        string;
  plan:              string;
  count:             number;
}): Promise<RateLimitResult> {
  const { social_account_id, phone_number_id, company_id, plan, count } = params;

  // Resolve tier from social_accounts
  // best-effort: an unreadable tier falls back to tier 1, the MOST restrictive limit, so a failed read never raises the cap
  const { data: account, error: tierError } = await ownedDbTable('social_accounts')
    .select('messaging_tier')
    .eq('id', social_account_id)
    .single();
  if (tierError) {
    console.warn('[whatsappRateLimiter] messaging_tier unreadable; using tier 1 (most restrictive)', {
      social_account_id, error: tierError.message,
    });
  }

  const tier      = account?.messaging_tier ?? 1;
  const tierLimit = TIER_LIMITS[tier] ?? TIER_LIMITS[1];
  const planLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const effective = Math.min(tierLimit, planLimit);

  const redisKey = `wa:usage:${phone_number_id}:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD
  const ttl      = 24 * 60 * 60; // 24h

  // ── Layer 1: Redis - ONE atomic INCRBY, then the comparison (CLASS-2 B5) ──
  // This was GET, compare, then INCRBY: two enqueues on one number (different broadcasts, so
  // not under one lease) both read room and both consumed it - over the tier/plan limit. And a
  // failed INCRBY (null) answered allowed:true with nothing counted. Now the increment IS the
  // reservation: over the limit -> given back and refused; a failed INCRBY (it may or may not
  // have counted) falls to the DB layer, which is atomic and fails closed - never allowed
  // without a counted consume.
  const newTotal = await redisIncrBy(redisKey, count, ttl);
  if (newTotal !== null) {
    if (newTotal > effective) {
      await redisDecrBy(redisKey, count);
      return { allowed: false, remaining: Math.max(0, effective - (newTotal - count)), tier, source: 'redis' };
    }
    return { allowed: true, remaining: Math.max(0, effective - newTotal), tier, source: 'redis' };
  }

  // ── Layer 2: DB fallback (Refinement 6) - atomic, fails CLOSED ────────────
  // An unlimited plan/tier is metered against the integer maximum (still counted).
  const dbLimit  = Number.isFinite(effective) ? effective : INT_MAX;
  // The usage day is the UTC date (toISOString is always UTC), matching the Redis key
  // above and WhatsApp's UTC-aligned daily window; a local-time day would misalign at
  // the boundary and over-permit.
  const consumed = await dbConsume(social_account_id, new Date().toISOString().slice(0, 10), count, dbLimit);
  if (!consumed) {
    return { allowed: false, remaining: 0, tier, source: 'db' };
  }
  const remaining = Number.isFinite(effective) ? Math.max(0, effective - consumed.used) : Infinity;
  return { allowed: consumed.allowed, remaining, tier, source: 'db' };
}

// ── Chunking strategy (Improvement 4) ────────────────────────────────────────

/**
 * Returns safe batch_size and inter-batch delay for a given tier.
 * Formula: batch_size = min(100, floor(tier_limit / 10))
 * Avoids spikes → better Meta delivery success rates.
 */
export function getBroadcastChunkStrategy(tier: number): ChunkStrategy {
  const tierLimit = TIER_LIMITS[tier] ?? TIER_LIMITS[1];

  if (!isFinite(tierLimit)) {
    return { batch_size: 500, delay_ms: 1000 };
  }

  const batch_size = Math.min(100, Math.floor(tierLimit / 10));
  // Scale delay inversely: larger batches → more breathing room
  const delay_ms   = batch_size >= 100 ? 2000 : batch_size >= 50 ? 3000 : 5000;

  return { batch_size, delay_ms };
}

// No daily reset job: the database counter is keyed by UTC day
// (whatsapp_daily_usage), and Redis keys expire by TTL. The former
// resetDailyCounters had no caller, and if wired it would have zeroed
// current_usage_day on EVERY active api_provider_accounts row - other
// components' counters - so it is removed rather than scheduled.
