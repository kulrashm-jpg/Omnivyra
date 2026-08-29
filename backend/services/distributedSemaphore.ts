/**
 * Redis-backed distributed semaphore with lease + dead-worker recovery.
 *
 * Each pool (drafting / alignment / refinement / repair / default) is one
 * semaphore. A slot is a row in a Redis ZSET keyed by `{pool}:slots` where
 * the score is the lease expiry timestamp (epoch ms) and the member is a
 * unique lease token. Acquisitions are atomic via Lua so two workers cannot
 * grab the same slot.
 *
 * Properties:
 *   - Atomic acquire (Lua: evict-expired then ZADD if size < max)
 *   - Lease auto-expiry (defaults 60s) so a crashed worker's slot eventually
 *     frees itself without operator intervention.
 *   - Heartbeat renewal for long-running calls — the holder pushes the score
 *     forward every `renewIntervalMs`.
 *   - Safe release on abort/failure — release is idempotent (no double-free).
 *   - Local fallback when Redis is unavailable (`DISTRIBUTED_POOL_ENABLED=0`
 *     or transient Redis outage). Falls back to a process-local counter so
 *     the planner keeps working — visible via the `usedFallback` field on
 *     the returned lease.
 *
 * Per-pool max size is read at acquire time, so changing env vars + calling
 * `reloadPoolSizes()` takes effect for new acquisitions immediately.
 *
 * INTENTIONAL LIMITATIONS:
 *   - Not strictly fair — first-claimant-wins. For "fair" queueing across
 *     instances, layer a Redis stream wait queue on top.
 *   - Clock skew between Redis and clients up to ~1s is tolerated by the
 *     60s default lease; larger skew risks early expiry.
 *   - Lua script is single-key. We don't span multiple keys, so we are not
 *     constrained by cluster-slot rules.
 */

import type IORedis from 'ioredis';
import { resolvePlannerFlag } from './plannerRolloutMode';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { getRequestContext } from './requestContext';

const KEY_PREFIX = 'planner:sem:';

/**
 * Lua script: try to grab a slot.
 *
 * KEYS[1] = pool key (zset)
 * ARGV[1] = now (ms)
 * ARGV[2] = lease expiry (ms epoch)
 * ARGV[3] = max size
 * ARGV[4] = lease token (uuid)
 *
 * Steps:
 *   1. Remove members whose score (lease expiry) < now — these are
 *      dead-worker slots that we're reclaiming.
 *   2. If ZCARD < max, ZADD this token with the new expiry score.
 *   3. PEXPIRE the key to cover the eventual case where every member
 *      expires (so the key doesn't linger forever).
 *   4. Return ZCARD (the new active count) and a boolean ack.
 */
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expiry = tonumber(ARGV[2])
local maxSize = tonumber(ARGV[3])
local token = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = redis.call('ZCARD', key)
if count < maxSize then
  redis.call('ZADD', key, expiry, token)
  redis.call('PEXPIRE', key, math.max(60000, expiry - now + 30000))
  return {1, count + 1}
end
return {0, count}
`;

/**
 * Lua script: renew a lease.
 *
 * KEYS[1] = pool key
 * ARGV[1] = lease token
 * ARGV[2] = new expiry (ms epoch)
 *
 * Returns 1 if the token was present and renewed, 0 otherwise (already
 * evicted — caller should NOT continue to assume it holds the slot).
 */
const RENEW_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
local expiry = tonumber(ARGV[2])
if redis.call('ZSCORE', key, token) then
  redis.call('ZADD', key, expiry, token)
  return 1
end
return 0
`;

/**
 * Lua script: release a slot.
 *
 * KEYS[1] = pool key
 * ARGV[1] = lease token
 *
 * Returns 1 if the token was present (we owned the slot), 0 otherwise.
 * Idempotent — double-release returns 0 and does nothing.
 */
const RELEASE_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
return redis.call('ZREM', key, token)
`;

export type PoolName = 'drafting' | 'alignment' | 'refinement' | 'repair' | 'default';

export interface SemaphoreLease {
  pool: PoolName;
  token: string;
  acquiredAt: number;
  /** When false, this acquire used the local-only fallback (Redis was
   *  unavailable). Callers can branch on this for logging but do not need
   *  to change behavior — release() always works. */
  usedFallback: boolean;
  /** Active count at acquire time (Redis path) or local active count
   *  (fallback path). Surfaced for the queue-wait telemetry log. */
  slotNumber: number;
  /** Internal — set by acquire(), used by renew()/release(). */
  _renewHandle?: ReturnType<typeof setInterval> | null;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Per-call lease TTL in ms. Default 60 000. Must be greater than the
   *  longest expected provider call so an in-flight call's lease doesn't
   *  expire under it. The heartbeat renews this. */
  leaseTtlMs?: number;
  /** Heartbeat interval in ms. Default leaseTtlMs/3. */
  renewIntervalMs?: number;
  /** Max time to wait in the acquire spin-loop, ms. Default 30 000. After
   *  this we throw — caller should treat like a queue starvation. */
  maxWaitMs?: number;
  /** How often to retry on contention, ms. Default 50. */
  pollIntervalMs?: number;
}

interface PoolLocalState {
  active: number;
  pending: number;
  recentWaitMsSamples: number[];
}

const _localPools: Record<PoolName, PoolLocalState> = {
  drafting:   { active: 0, pending: 0, recentWaitMsSamples: [] },
  alignment:  { active: 0, pending: 0, recentWaitMsSamples: [] },
  refinement: { active: 0, pending: 0, recentWaitMsSamples: [] },
  repair:     { active: 0, pending: 0, recentWaitMsSamples: [] },
  default:    { active: 0, pending: 0, recentWaitMsSamples: [] },
};

let _poolSizes: Record<PoolName, number> = {
  drafting:   5,
  alignment:  5,
  refinement: 5,
  repair:     5,
  default:    5,
};

const RECENT_WAIT_SAMPLE_LIMIT = 32;

export function reloadPoolSizes(): Record<PoolName, number> {
  const legacy = Math.max(1, Number(process.env.MAX_LLM_CONCURRENCY || 5));
  const readEnv = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
  };
  _poolSizes = {
    drafting:   readEnv('MAX_DRAFTING_CONCURRENCY', legacy),
    alignment:  readEnv('MAX_ALIGNMENT_CONCURRENCY', legacy),
    refinement: readEnv('MAX_REFINEMENT_CONCURRENCY', legacy),
    repair:     readEnv('MAX_REPAIR_CONCURRENCY', legacy),
    default:    legacy,
  };
  return _poolSizes;
}

reloadPoolSizes();

let _redisClient: IORedis | null = null;
let _redisFailureCount = 0;
const REDIS_DISABLE_THRESHOLD = 5;

/**
 * Lazily resolves the standalone Redis client. Returns null if the
 * distributed pool is disabled OR if Redis has failed repeatedly recently
 * (circuit breaker — we'll retry every minute).
 */
function getRedisOrNull(): IORedis | null {
  if (!resolvePlannerFlag('DISTRIBUTED_POOL_ENABLED', true)) {
    return null;
  }
  if (_redisFailureCount >= REDIS_DISABLE_THRESHOLD) return null;
  if (_redisClient) return _redisClient;
  try {
    const { getInstrumentedStandaloneRedisClient } =
      require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
    _redisClient = getInstrumentedStandaloneRedisClient('planner-semaphore');
    return _redisClient;
  } catch (err) {
    logger.warn('distributed_semaphore_redis_unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    _redisFailureCount = REDIS_DISABLE_THRESHOLD;
    return null;
  }
}

function recordWait(pool: PoolName, waitMs: number): void {
  const s = _localPools[pool].recentWaitMsSamples;
  s.push(waitMs);
  if (s.length > RECENT_WAIT_SAMPLE_LIMIT) s.shift();
}

function poolKey(pool: PoolName): string {
  return `${KEY_PREFIX}${pool}`;
}

async function tryAcquireDistributed(
  client: IORedis,
  pool: PoolName,
  leaseTtlMs: number,
): Promise<{ ok: boolean; token: string; activeCount: number }> {
  // Optional Redis client span — `client` kind so trace explorers group
  // these under the parent planner span as outgoing dependencies. Wrapped
  // in try/catch so a tracing-module failure never breaks acquire.
  try {
    const { withSpan } = require('./plannerTracing') as typeof import('./plannerTracing');
    return await withSpan(`redis/eval/sem_acquire/${pool}`, async (span) => {
      span.setAttribute('redis.script', 'sem_acquire');
      span.setAttribute('redis.pool', pool);
      span.setAttribute('redis.lease_ttl_ms', leaseTtlMs);
      return await acquireImpl();
    }, { kind: 'client' });
  } catch {
    return acquireImpl();
  }

  async function acquireImpl(): Promise<{ ok: boolean; token: string; activeCount: number }> {
    const token = randomUUID();
    const now = Date.now();
    const expiry = now + leaseTtlMs;
    // eval returns [ok, activeCount]
    const result = (await client.eval(
      ACQUIRE_SCRIPT,
      1,
      poolKey(pool),
      String(now),
      String(expiry),
      String(_poolSizes[pool]),
      token,
    )) as [number, number];
    return {
      ok: result[0] === 1,
      token,
      activeCount: result[1],
    };
  }
}

export async function acquire(
  pool: PoolName,
  opts: AcquireOptions = {},
): Promise<SemaphoreLease> {
  const start = Date.now();
  const leaseTtlMs = Math.max(5000, opts.leaseTtlMs ?? 60_000);
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 30_000);
  const pollIntervalMs = Math.max(20, opts.pollIntervalMs ?? 50);
  const renewIntervalMs = Math.max(1000, opts.renewIntervalMs ?? Math.floor(leaseTtlMs / 3));

  if (opts.signal?.aborted) {
    throw Object.assign(new Error('semaphore acquire aborted'), {
      code: 'SEMAPHORE_ABORTED',
    });
  }

  const client = getRedisOrNull();
  _localPools[pool].pending += 1;

  try {
    // ── Fast path: Redis-backed acquire ───────────────────────────────────
    if (client && client.status !== 'end') {
      while (true) {
        try {
          const r = await tryAcquireDistributed(client, pool, leaseTtlMs);
          if (r.ok) {
            _redisFailureCount = 0;
            const waitMs = Date.now() - start;
            recordWait(pool, waitMs);
            _localPools[pool].active += 1;
            return startHeartbeat(
              {
                pool,
                token: r.token,
                acquiredAt: Date.now(),
                usedFallback: false,
                slotNumber: r.activeCount,
              },
              client,
              leaseTtlMs,
              renewIntervalMs,
            );
          }
        } catch (err) {
          _redisFailureCount += 1;
          logger.warn('distributed_semaphore_acquire_failed', {
            pool,
            failure_count: _redisFailureCount,
            error: err instanceof Error ? err.message : String(err),
          });
          break; // Drop into local fallback below.
        }
        if (opts.signal?.aborted) {
          throw Object.assign(new Error('semaphore acquire aborted'), {
            code: 'SEMAPHORE_ABORTED',
          });
        }
        if (Date.now() - start > maxWaitMs) {
          throw Object.assign(new Error(`semaphore acquire timeout (pool=${pool}, waited=${Date.now() - start}ms)`), {
            code: 'SEMAPHORE_TIMEOUT',
          });
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    }

    // ── Fallback: local-only acquire (Redis unavailable or disabled) ──────
    while (_localPools[pool].active >= _poolSizes[pool]) {
      if (opts.signal?.aborted) {
        throw Object.assign(new Error('semaphore acquire aborted'), {
          code: 'SEMAPHORE_ABORTED',
        });
      }
      if (Date.now() - start > maxWaitMs) {
        throw Object.assign(new Error(`semaphore acquire timeout (local fallback, pool=${pool})`), {
          code: 'SEMAPHORE_TIMEOUT',
        });
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    _localPools[pool].active += 1;
    const waitMs = Date.now() - start;
    recordWait(pool, waitMs);
    return {
      pool,
      token: randomUUID(),
      acquiredAt: Date.now(),
      usedFallback: true,
      slotNumber: _localPools[pool].active,
    };
  } finally {
    _localPools[pool].pending = Math.max(0, _localPools[pool].pending - 1);
  }
}

function startHeartbeat(
  lease: SemaphoreLease,
  client: IORedis,
  leaseTtlMs: number,
  renewIntervalMs: number,
): SemaphoreLease {
  const renew = async (): Promise<void> => {
    try {
      const expiry = Date.now() + leaseTtlMs;
      const result = (await client.eval(
        RENEW_SCRIPT,
        1,
        poolKey(lease.pool),
        lease.token,
        String(expiry),
      )) as number;
      if (result !== 1) {
        // Our lease was already evicted — abandon the heartbeat. The slot
        // is technically reclaimable by another worker. Caller's release()
        // will be a no-op for this token. We log so ops can see lease
        // contention.
        logger.warn('distributed_semaphore_lease_lost', {
          request_id: getRequestContext().requestId,
          pool: lease.pool,
          token: lease.token,
        });
        try {
          const { recordPlannerAlertCounter } = require('./plannerAlerting') as typeof import('./plannerAlerting');
          recordPlannerAlertCounter('lease_lost', { pool: lease.pool });
        } catch { /* alerting is best-effort */ }
        if (lease._renewHandle) {
          clearInterval(lease._renewHandle);
          lease._renewHandle = null;
        }
      }
    } catch (err) {
      // Renewal failure is non-fatal — the lease will expire and another
      // worker will reclaim the slot eventually. Don't crash.
      logger.warn('distributed_semaphore_renew_failed', {
        pool: lease.pool,
        token: lease.token,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  lease._renewHandle = setInterval(renew, renewIntervalMs);
  // Unref so the timer doesn't keep the process alive past the call.
  try { (lease._renewHandle as any).unref?.(); } catch { /* noop */ }
  return lease;
}

export async function release(lease: SemaphoreLease): Promise<void> {
  // Stop heartbeat regardless of path.
  if (lease._renewHandle) {
    clearInterval(lease._renewHandle);
    lease._renewHandle = null;
  }
  // Decrement local counter (tracking, not gating, when Redis is in use).
  _localPools[lease.pool].active = Math.max(0, _localPools[lease.pool].active - 1);

  if (lease.usedFallback) return;

  const client = getRedisOrNull();
  if (!client || client.status === 'end') return;
  try {
    await client.eval(
      RELEASE_SCRIPT,
      1,
      poolKey(lease.pool),
      lease.token,
    );
  } catch (err) {
    // Release failure means the lease will be reclaimed by Lua expiry. Log
    // and move on — never throw from release().
    logger.warn('distributed_semaphore_release_failed', {
      pool: lease.pool,
      token: lease.token,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface PoolSnapshot {
  pool: PoolName;
  /** Active count visible to this process (Redis path: count from last
   *  acquire response; fallback path: in-memory counter). For an accurate
   *  cluster-wide view, query Redis ZCARD directly. */
  active: number;
  /** Callers currently waiting on a slot in this process. */
  pending: number;
  maxAllowed: number;
  recentAvgWaitMs: number;
  /** True when the most-recent acquire used the local fallback (Redis
   *  unavailable). */
  fallbackInUse: boolean;
}

export function snapshot(pool: PoolName): PoolSnapshot {
  const s = _localPools[pool];
  const samples = s.recentWaitMsSamples;
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
  return {
    pool,
    active: s.active,
    pending: s.pending,
    maxAllowed: _poolSizes[pool],
    recentAvgWaitMs: avg,
    fallbackInUse: _redisFailureCount >= REDIS_DISABLE_THRESHOLD,
  };
}

export function snapshotAll(): Record<PoolName, PoolSnapshot> {
  return {
    drafting:   snapshot('drafting'),
    alignment:  snapshot('alignment'),
    refinement: snapshot('refinement'),
    repair:     snapshot('repair'),
    default:    snapshot('default'),
  };
}

/**
 * Read the cluster-wide active count for a pool via Redis ZCARD. Returns
 * null when Redis is unavailable. Used for dashboards / forensic queries —
 * not on the hot path.
 */
export async function getDistributedActiveCount(pool: PoolName): Promise<number | null> {
  const client = getRedisOrNull();
  if (!client || client.status === 'end') return null;
  try {
    // Evict expired before counting so we don't include dead leases.
    await client.zremrangebyscore(poolKey(pool), '-inf', Date.now());
    return await client.zcard(poolKey(pool));
  } catch {
    return null;
  }
}

/** Test-only: reset all local counters + failure tracking. */
export function __resetForTests(): void {
  for (const p of Object.keys(_localPools) as PoolName[]) {
    _localPools[p].active = 0;
    _localPools[p].pending = 0;
    _localPools[p].recentWaitMsSamples.length = 0;
  }
  _redisFailureCount = 0;
  _redisClient = null;
}
