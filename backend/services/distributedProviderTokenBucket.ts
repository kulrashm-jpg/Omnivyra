/**
 * Cluster-wide provider token bucket (Redis Lua).
 *
 * Same semantics as `providerTokenBucket.ts` but the bucket state lives in
 * Redis so every instance shares one cluster-wide rate limit instead of N
 * per-process limits. Each provider has one key:
 *
 *   planner:bucket:openai     → HASH { tokens, lastRefillAt, qps, burst }
 *   planner:bucket:anthropic  → HASH { ... }
 *
 * The acquire Lua script atomically:
 *   1. reads {tokens, lastRefillAt}
 *   2. refills based on (now - lastRefillAt) * qps / 1000
 *   3. if tokens >= 1 → decrement and return success
 *   4. else return failure with computed `retry_after_ms`
 *
 * Retry-aware reservations: the script can also reserve a future token by
 * pushing `tokens` to negative via `RESERVE` mode — the next refill applies
 * to the deficit first. This makes retries fair under contention.
 *
 * Refund: refunds increment the bucket by 1 (capped to burst). Safe to call
 * multiple times — the cap prevents over-refund.
 *
 * Fallback: when Redis is unavailable OR `DISTRIBUTED_PROVIDER_BUCKET_ENABLED`
 * is off, callers transparently use the existing per-process bucket from
 * `providerTokenBucket.ts`. The per-process bucket stays as both the local
 * fallback path and the legacy default.
 */

import type IORedis from 'ioredis';
import { logger } from './logger';
import { getRequestContext } from './requestContext';
import { recordPlannerAlertCounter } from './plannerAlerting';

export type ProviderName = 'openai' | 'anthropic';

const KEY_PREFIX = 'planner:bucket:';
const FAILURE_DISABLE_THRESHOLD = 5;
let _failureCount = 0;
let _client: IORedis | null = null;

/**
 * Lua: acquire one token (or reserve if RESERVE flag passed).
 *
 * KEYS[1] = bucket key (HASH)
 * ARGV[1] = now (ms)
 * ARGV[2] = qps           (refill rate, tokens/s)
 * ARGV[3] = burst         (cap)
 * ARGV[4] = reserve_flag  ('1' = allow tokens to go negative as a reservation)
 *
 * Returns:
 *   [granted, tokens_after, retry_after_ms]
 *   granted = 1 → consumer holds a token
 *   granted = 0 → not granted; consumer should wait retry_after_ms or fail
 */
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local qps = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local reserve = ARGV[4] == '1'
local state = redis.call('HMGET', key, 'tokens', 'lastRefillAt')
local tokens = tonumber(state[1]) or burst
local lastRefillAt = tonumber(state[2]) or now
local elapsedMs = now - lastRefillAt
if elapsedMs > 0 then
  tokens = math.min(burst, tokens + (qps * elapsedMs) / 1000)
end
local granted = 0
local retry_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
elseif reserve then
  tokens = tokens - 1
  granted = 1  -- reserved (negative balance allowed)
else
  -- Wait time = ceil((1 - tokens) / qps * 1000)
  if qps > 0 then
    retry_ms = math.ceil((1 - tokens) / qps * 1000)
  else
    retry_ms = 1000
  end
end
redis.call('HMSET', key, 'tokens', tokens, 'lastRefillAt', now, 'qps', qps, 'burst', burst)
redis.call('PEXPIRE', key, 600000)  -- 10-minute key TTL so idle buckets auto-clean
return {granted, tonumber(string.format('%.4f', tokens)), retry_ms}
`;

/**
 * Lua: refund one token (cap at burst).
 *
 * KEYS[1] = bucket key
 * ARGV[1] = burst cap
 *
 * Returns post-refund token count.
 */
const REFUND_SCRIPT = `
local key = KEYS[1]
local burst = tonumber(ARGV[1])
local cur = tonumber(redis.call('HGET', key, 'tokens')) or burst
local nextVal = math.min(burst, cur + 1)
redis.call('HSET', key, 'tokens', nextVal)
return tonumber(string.format('%.4f', nextVal))
`;

function isEnabled(): boolean {
  return String(process.env.DISTRIBUTED_PROVIDER_BUCKET_ENABLED ?? 'false').toLowerCase() === 'true';
}

function getRedisOrNull(): IORedis | null {
  if (!isEnabled()) return null;
  if (_failureCount >= FAILURE_DISABLE_THRESHOLD) return null;
  if (_client) return _client;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _client = getInstrumentedStandaloneRedisClient('planner-provider-bucket');
    return _client;
  } catch (err) {
    _failureCount = FAILURE_DISABLE_THRESHOLD;
    logger.warn('distributed_provider_bucket_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function bucketKey(provider: ProviderName): string {
  return `${KEY_PREFIX}${provider}`;
}

function configFor(provider: ProviderName): { qps: number; burst: number } {
  const qps = Number(
    provider === 'openai'
      ? process.env.OPENAI_QPS_LIMIT || 8
      : process.env.ANTHROPIC_QPS_LIMIT || 4,
  );
  const burst = Number(process.env.PROVIDER_BUCKET_BURST || 16);
  return {
    qps: Number.isFinite(qps) && qps > 0 ? qps : 8,
    burst: Number.isFinite(burst) && burst >= 1 ? Math.floor(burst) : 16,
  };
}

export interface DistributedTokenReceipt {
  provider: ProviderName;
  waitMs: number;
  acquired: boolean;
  /** Tokens left in the cluster bucket after this acquire. */
  tokensAfter: number;
  /** True when distributed mode was disabled or Redis unavailable — caller
   *  should fall through to the per-process bucket. */
  fellThrough: boolean;
  /** Set after `markDistributedRequestStarted` — refund becomes a no-op. */
  _started?: boolean;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  /** When true, the bucket allows a negative token balance — the caller's
   *  reservation will be repaid by the next refill. Used for retries so a
   *  fair share is reserved rather than starving behind fresh requests. */
  reserve?: boolean;
}

/**
 * Acquire a cluster-wide token. Returns `{ fellThrough: true }` when distributed
 * mode is disabled/unavailable so the caller knows to fall through to the
 * per-process bucket.
 */
export async function acquireDistributed(
  provider: ProviderName,
  opts: AcquireOptions = {},
): Promise<DistributedTokenReceipt> {
  const client = getRedisOrNull();
  if (!client) {
    return { provider, waitMs: 0, acquired: false, tokensAfter: 0, fellThrough: true };
  }
  const cfg = configFor(provider);
  const startAt = Date.now();
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 5_000);
  const pollIntervalMs = Math.max(20, opts.pollIntervalMs ?? 50);
  const reserveArg = opts.reserve ? '1' : '0';

  if (opts.signal?.aborted) {
    throw Object.assign(new Error('distributed provider bucket aborted'), {
      code: 'DISTRIBUTED_PROVIDER_BUCKET_ABORTED',
    });
  }

  while (true) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error('distributed provider bucket aborted'), {
        code: 'DISTRIBUTED_PROVIDER_BUCKET_ABORTED',
      });
    }
    let result: [number, number, number];
    try {
      result = (await client.eval(
        ACQUIRE_SCRIPT,
        1,
        bucketKey(provider),
        String(Date.now()),
        String(cfg.qps),
        String(cfg.burst),
        reserveArg,
      )) as [number, number, number];
    } catch (err) {
      _failureCount += 1;
      logger.warn('distributed_provider_bucket_acquire_failed', {
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
      // Treat as fall-through so the caller can use the per-process bucket.
      return { provider, waitMs: Date.now() - startAt, acquired: false, tokensAfter: 0, fellThrough: true };
    }
    const granted = result[0] === 1;
    const tokensAfter = Number(result[1]);
    const retryMs = Number(result[2]);
    if (granted) {
      const waitMs = Date.now() - startAt;
      if (waitMs > 0) {
        logger.info('distributed_provider_bucket_wait', {
          request_id: getRequestContext().requestId,
          provider,
          wait_ms: waitMs,
          tokens_left: tokensAfter,
        });
      }
      return { provider, waitMs, acquired: true, tokensAfter, fellThrough: false };
    }
    if (Date.now() - startAt + Math.min(retryMs, pollIntervalMs) > maxWaitMs) {
      logger.warn('distributed_provider_bucket_exhausted', {
        request_id: getRequestContext().requestId,
        provider,
        wait_ms: Date.now() - startAt,
        max_wait_ms: maxWaitMs,
        retry_after_ms: retryMs,
        tokens: tokensAfter,
      });
      recordPlannerAlertCounter('provider_bucket_exhausted', { provider, distributed: true });
      throw Object.assign(
        new Error(`distributed provider ${provider} bucket exhausted (qps=${cfg.qps}, waited ${Date.now() - startAt}ms)`),
        { code: 'PROVIDER_BUCKET_EXHAUSTED', status: 429 },
      );
    }
    await new Promise((r) => setTimeout(r, Math.max(pollIntervalMs, Math.min(retryMs, 500))));
  }
}

export function markDistributedRequestStarted(receipt: DistributedTokenReceipt): void {
  receipt._started = true;
}

export async function refundDistributed(receipt: DistributedTokenReceipt): Promise<void> {
  if (!receipt.acquired || receipt._started || receipt.fellThrough) return;
  const client = getRedisOrNull();
  if (!client) return;
  try {
    const cfg = configFor(receipt.provider);
    const next = (await client.eval(REFUND_SCRIPT, 1, bucketKey(receipt.provider), String(cfg.burst))) as number;
    logger.info('distributed_provider_bucket_recovered', {
      request_id: getRequestContext().requestId,
      provider: receipt.provider,
      tokens: next,
    });
    receipt.acquired = false;
  } catch (err) {
    _failureCount += 1;
    logger.warn('distributed_provider_bucket_refund_failed', {
      provider: receipt.provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface DistributedBucketSnapshot {
  provider: ProviderName;
  tokens: number | null;
  qps: number;
  burst: number;
  enabled: boolean;
  redisHealthy: boolean;
}

export async function distributedBucketSnapshot(provider: ProviderName): Promise<DistributedBucketSnapshot> {
  const cfg = configFor(provider);
  const enabled = isEnabled();
  const client = getRedisOrNull();
  if (!client) {
    return { provider, tokens: null, qps: cfg.qps, burst: cfg.burst, enabled, redisHealthy: false };
  }
  try {
    const cur = await client.hget(bucketKey(provider), 'tokens');
    return {
      provider,
      tokens: cur === null ? cfg.burst : Number(cur),
      qps: cfg.qps,
      burst: cfg.burst,
      enabled,
      redisHealthy: true,
    };
  } catch {
    return { provider, tokens: null, qps: cfg.qps, burst: cfg.burst, enabled, redisHealthy: false };
  }
}
