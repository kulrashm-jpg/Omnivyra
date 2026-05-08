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

async function redisGetCount(key: string): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    return val === null ? 0 : parseInt(val, 10);
  } catch {
    return null; // Redis unavailable → fall through to DB
  }
}

async function redisIncrBy(key: string, count: number, ttlSeconds: number): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
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

async function dbGetDailyUsage(socialAccountId: string): Promise<number> {
  const { data } = await ownedDbTable('social_accounts')
    .select('messaging_tier')
    .eq('id', socialAccountId)
    .single();

  // Read current_usage_day from api_provider_accounts linked to this WA source
  const { data: usage } = await ownedDbTable('api_provider_accounts')
    .select('current_usage_day')
    .eq('account_name', socialAccountId) // best available link without schema change
    .single();

  return usage?.current_usage_day ?? 0;
}

async function dbIncrUsage(socialAccountId: string, count: number): Promise<void> {
  await supabase.rpc('increment_wa_usage', {
    account_id: socialAccountId,
    increment:  count,
  });
  // If RPC doesn't exist yet, falls through silently — DB becomes best-effort
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
  const { data: account } = await ownedDbTable('social_accounts')
    .select('messaging_tier')
    .eq('id', social_account_id)
    .single();

  const tier      = account?.messaging_tier ?? 1;
  const tierLimit = TIER_LIMITS[tier] ?? TIER_LIMITS[1];
  const planLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const effective = Math.min(tierLimit, planLimit);

  const redisKey = `wa:usage:${phone_number_id}:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD
  const ttl      = 24 * 60 * 60; // 24h

  // ── Layer 1: Redis ────────────────────────────────────────────────────────
  const currentRedis = await redisGetCount(redisKey);

  if (currentRedis !== null) {
    // Redis is available
    if (currentRedis + count > effective) {
      return { allowed: false, remaining: Math.max(0, effective - currentRedis), tier, source: 'redis' };
    }
    const newTotal = await redisIncrBy(redisKey, count, ttl);
    const remaining = newTotal !== null ? Math.max(0, effective - newTotal) : 0;
    return { allowed: true, remaining, tier, source: 'redis' };
  }

  // ── Layer 2: DB fallback (Refinement 6) ───────────────────────────────────
  const currentDb = await dbGetDailyUsage(social_account_id);

  if (currentDb + count > effective) {
    return { allowed: false, remaining: Math.max(0, effective - currentDb), tier, source: 'db' };
  }

  await dbIncrUsage(social_account_id, count);
  return { allowed: true, remaining: Math.max(0, effective - currentDb - count), tier, source: 'db' };
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

// ── Daily counter reset ───────────────────────────────────────────────────────

/**
 * Reset daily usage counters for all WhatsApp phone numbers.
 * Schedule via cron at 00:00 UTC.
 * Redis keys auto-expire via TTL; this resets the DB backup counters.
 */
export async function resetDailyCounters(): Promise<void> {
  // api_provider_accounts.current_usage_day reset for WA sources
  const { error } = await ownedDbTable('api_provider_accounts')
    .update({ current_usage_day: 0, last_reset_at: new Date().toISOString() })
    .eq('is_active', true);
    // Note: filter by WA api_source_id once WhatsApp is added to external_api_sources

  if (error) console.error('[whatsappRateLimiter] resetDailyCounters failed:', error.message);
}
