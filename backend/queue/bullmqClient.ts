/**
 * BullMQ Client Configuration
 * 
 * Initializes Redis connection and creates Queue/Worker instances for background job processing.
 * 
 * Requirements:
 * - REDIS_URL environment variable (e.g., redis://localhost:6379)
 * - Redis server running (use docker run -p 6379:6379 redis:7)
 * 
 * Usage:
 *   import { getQueue, getWorker } from './backend/queue/bullmqClient';
 *   const queue = getQueue();
 *   const worker = getWorker('publish', async (job) => { ... });
 */

import { Queue, Worker } from 'bullmq';
import {
  instrumentQueue,
  instrumentWorker,
  startQueueReportFlush,
} from './queueInstrumentation';
import { runWithJobTraceContext } from '../observability/traceKit';
import { deadLetterOnExhaustion } from './deadLetterOnExhaustion';
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';
import { getMetricsReport } from '../../lib/redis/instrumentation';
import IORedis from 'ioredis';
import { createHash } from 'crypto';
import { isRedisUrlTLS } from '../../lib/redis/sanitizer';
import {
  boundedRetryStrategy,
  isNonRecoverableRedisError,
  reconnectOnError,
} from '../../lib/redis/retryPolicy';
import {
  createInstrumentedClient,
  startInstrumentation,
  type RedisFeature,
} from '../../lib/redis/instrumentation';
import {
  startUsageProtection,
  isQueueAllowed,
  getQueueFanOutMultiplier,
  storeOverflow,
  registerOverflowDrain,
  type OverflowEntry,
} from '../../lib/redis/usageProtection';
import { startMetricsPersistence } from '../../lib/instrumentation/metricsPersistence';
import { getSystemMetrics }        from '../../lib/instrumentation/systemMetrics';
import { estimateCost }            from '../../lib/instrumentation/costEngine';
import { config }                  from '@/config';

const REDIS_URL = config.REDIS_URL;

/**
 * Environment isolation for BullMQ key namespace.
 *
 * Without a per-environment prefix, every BullMQ instance pointed at the
 * same Redis (e.g. production Upstash) shares a single keyspace. A laptop
 * running `npm run dev:full` against the production REDIS_URL — which
 * `.env.local` resolves to in this project — would otherwise process and
 * emit jobs on the same queues as the Railway production worker.
 *
 * Cloud platforms set their own env signals (VERCEL_ENV, RAILWAY_ENVIRONMENT)
 * that we trust as authoritative. Absent both, we resolve to `local`
 * regardless of OMNIVYRA_ENV — the whole point of this guard is that
 * `.env.local` cannot be trusted to distinguish a laptop from production.
 */
function getRuntimeEnv(): string {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV;
  if (process.env.RAILWAY_ENVIRONMENT) {
    return process.env.RAILWAY_ENVIRONMENT === 'production'
      ? 'production'
      : `railway-${process.env.RAILWAY_ENVIRONMENT}`;
  }
  if (process.env.NODE_ENV === 'test') return 'test';
  return 'local';
}

let _queuePrefix: string | null = null;

/**
 * Migration safety flag. When DISABLED (default), getQueuePrefix() returns
 * BullMQ's default `'bull'` prefix so a deploy of the prefix-enabled code
 * keeps consuming jobs from the legacy keyspace — no in-flight production
 * work gets orphaned on rollout.
 *
 * Per-environment cutover protocol:
 *   1. Deploy with the flag UNSET — verifies the prefix code path compiles
 *      and ships without any behavior change.
 *   2. Stop enqueueing (or wait until queue depths reach zero) so the
 *      legacy `bull:*` keyspace is drained.
 *   3. Set OMNIVYRA_QUEUE_PREFIX_ENABLED=true on the producer (Vercel) and
 *      consumer (Railway worker) and restart both. All new jobs land in
 *      `omnivyra:<env>::*` and are isolated from other environments.
 *   4. The legacy `bull:*` keyspace becomes inert and TTL-expires.
 *
 * The flag is read once per process and memoized via `_queuePrefix` so an
 * accidental mid-process toggle cannot split traffic across two keyspaces.
 */
function isQueuePrefixEnabled(): boolean {
  return process.env.OMNIVYRA_QUEUE_PREFIX_ENABLED === 'true';
}

/**
 * Returns the BullMQ `prefix` value that every Queue / Worker / QueueEvents /
 * FlowProducer instance in this codebase MUST pass. Memoized so the resolved
 * env is stable for the lifetime of the process.
 *
 * Returns BullMQ's default `'bull'` when the migration flag is OFF, so call
 * sites are identical regardless of rollout phase.
 */
export function getQueuePrefix(): string {
  if (_queuePrefix === null) {
    _queuePrefix = isQueuePrefixEnabled()
      ? `omnivyra:${getRuntimeEnv()}:`
      : 'bull';
  }
  return _queuePrefix;
}

// Parse Redis connection options — includes TLS for Upstash hosts
function parseRedisUrl(url: string) {
  // Strip any redis-cli command prefix (e.g. "redis-cli --tls -u redis://...")
  const urlMatch = url.match(/rediss?:\/\/\S+/);
  if (urlMatch) url = urlMatch[0];

  if (url.includes('://')) {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // TLS decision is centralized in sanitizer.isRedisUrlTLS (single
    // authority) — honors BOTH rediss:// scheme AND Upstash hosts.
    const needsTls = isRedisUrlTLS(url);
    return {
      host,
      port: parseInt(parsed.port || '6379'),
      password: parsed.password || undefined,
      ...(needsTls ? { tls: {} } : {}),
    };
  }
  return {
    host: 'localhost',
    port: 6379,
    password: undefined,
  };
}

const redisConfig = parseRedisUrl(REDIS_URL);
const IS_OPTIONAL_LOCAL_REDIS =
  redisConfig.host === 'localhost' || redisConfig.host === '127.0.0.1';
const REDIS_ERROR_LOG_COOLDOWN_MS = 30_000;
const REDIS_PREFLIGHT_TIMEOUT_MS = 2_000;

/**
 * W2-7 (audit B-21) rollout flag: with 'redis-shared-connection' ON, the two
 * connection-options getters below hand BullMQ the SHARED IORedis instance
 * instead of an options object — every Queue/Worker built from them reuses
 * one physical connection (BullMQ duplicate()s internally for blocking ops)
 * instead of opening its own TLS+AUTH connection against Upstash. Off
 * (default) = today's per-instance connections, byte-for-byte. Every caller
 * uses the value solely as a BullMQ `connection:` (verified W2-7), which
 * accepts both shapes. Kill: ROLLOUT_REDIS_SHARED_CONNECTION_KILL.
 */
const REDIS_SHARED_CONNECTION_FLAG = defineRolloutFlag({
  key: 'redis-shared-connection',
  description: 'W2-7: BullMQ queues/workers reuse the shared Redis connection (audit B-21)',
});

export function getRedisConfig(): IORedis | typeof redisConfig {
  if (resolveRolloutSync(REDIS_SHARED_CONNECTION_FLAG).mode !== 'off') return getRedisConnection();
  return redisConfig;
}

/**
 * Full IORedis-compatible connection options including TLS for Upstash.
 *
 * IMPORTANT: this config is shared by both Queue producers AND Worker
 * consumers. BullMQ Workers issue blocking `BLPOP` commands to fetch jobs
 * and require `maxRetriesPerRequest: null` on their Redis connection —
 * any finite value times the BLPOP out after that many retries and the
 * worker silently stops polling. Previously this was `1` for localhost
 * Redis under the assumption that fail-fast was preferable in dev, but
 * the consequence was that every Worker routed through this config
 * (analytics-ingestion, publish, bolt-execution, whatsapp-broadcast,
 * whatsapp-webhook, the entire content-generation family) stopped
 * consuming jobs on localhost. Production was unaffected because
 * IS_OPTIONAL_LOCAL_REDIS was false there. The intelligence-polling
 * worker (which has its own getConnection() that already hard-codes
 * `maxRetriesPerRequest: null`) was the only worker still working in
 * dev — that is why it was the one queue with completed jobs in the
 * runtime audit.
 *
 * Unconditionally setting `null` matches BullMQ's documented requirement
 * and works identically for Queue producers (no retry budget needed on
 * a non-blocking SADD/ZADD). The localhost-only `retryStrategy: () =>
 * null` is also removed because under a transient Redis blip on
 * localhost it left the worker permanently disconnected; BullMQ Worker
 * survives Redis reconnects natively when the strategy is left default.
 */
export function getConnectionConfig(): IORedis | Record<string, unknown> {
  // W2-7: shared-connection mode (see REDIS_SHARED_CONNECTION_FLAG above).
  if (resolveRolloutSync(REDIS_SHARED_CONNECTION_FLAG).mode !== 'off') return getRedisConnection();
  return rawConnectionOptions();
}

/**
 * The historical per-instance options object (probe + flag-off callers).
 * CERT-FIX P2: exported (getRawConnectionOptions) for the two consumers that
 * SPREAD connection options into their own `new Redis({...})` — spreading a
 * live client instance (what getConnectionConfig returns under W2-7) would
 * silently fall back to localhost. Spread-consumers must use THIS.
 */
export function getRawConnectionOptions(): Record<string, unknown> {
  return rawConnectionOptions();
}

function rawConnectionOptions(): Record<string, unknown> {
  return {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    ...(redisConfig.tls ? { tls: redisConfig.tls } : {}),
    enableReadyCheck: false,
    maxRetriesPerRequest: null as null,
    lazyConnect: true,
    // Bound the TCP connect phase so a cold start / TLS misconfig fails
    // visibly instead of hanging. commandTimeout is intentionally NOT set
    // here: this config backs BullMQ Worker connections that issue blocking
    // BRPOPLPUSH/BLMOVE (drainDelay 300s) — a per-command timeout would abort
    // job fetch and silently stop consumption. (Non-blocking standalone
    // clients enforce commandTimeout in lib/redis/client.ts & queue/redis.ts.)
    connectTimeout: 10_000,
    // Bounded reconnect: ioredis default reconnects every <=2s forever, which
    // under an Upstash outage is a reconnect+AUTH storm (each AUTH is billed).
    // boundedRetryStrategy caps reconnect spacing at 30s with jitter; still
    // recovers within seconds of a brief blip. reconnectOnError skips
    // reconnects on quota/credential errors a reconnect cannot fix.
    retryStrategy: boundedRetryStrategy,
    reconnectOnError,
  };
}

/**
 * Quiet readiness probe for process bootstraps.
 *
 * Local Redis is optional for app-only/dev flows. If workers or cron are
 * started while localhost Redis is absent, creating BullMQ Queue/Worker
 * instances causes an endless ECONNREFUSED loop. Probe first and let callers
 * skip Redis-backed background runtimes locally. Managed Redis remains a hard
 * dependency: a failed probe throws so production supervisors restart loudly.
 */
export async function verifyRedisReadyForBackgroundRuntime(context: string): Promise<boolean> {
  const probe = new IORedis({
    // Raw options ALWAYS (never the W2-7 shared instance) — the probe is a
    // deliberately short-lived throwaway connection.
    ...rawConnectionOptions(),
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    reconnectOnError: () => false,
  });

  probe.on('error', () => {
    // Suppress expected localhost ECONNREFUSED noise during the readiness probe.
  });

  try {
    await Promise.race([
      probe.connect().then(() => probe.ping()),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Redis preflight timed out after ${REDIS_PREFLIGHT_TIMEOUT_MS}ms`)),
          REDIS_PREFLIGHT_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (IS_OPTIONAL_LOCAL_REDIS) {
      console.warn(`[${context}] Redis unavailable at ${redisConfig.host}:${redisConfig.port}; skipping Redis-backed background runtime.`);
      return false;
    }
    throw new Error(`[${context}] Redis preflight failed for ${redisConfig.host}:${redisConfig.port}: ${message}`);
  } finally {
    probe.disconnect(false);
  }
}

// Redis connection instance (shared across Queue/Worker)
let redisConnection: IORedis | null = null;
let redisInfraStarted = false;
let usageProtectionReadyPromise: Promise<void> = Promise.resolve();
let redisUnavailable = false;
let lastRedisErrorLogAt = 0;
let redisConsecutiveFailures = 0;
let redisNonRecoverableFailures = 0;

function logRedisErrorOnce(err: unknown): void {
  const now = Date.now();
  if (now - lastRedisErrorLogAt < REDIS_ERROR_LOG_COOLDOWN_MS) return;
  lastRedisErrorLogAt = now;
  console.error('Redis connection error:', err);
}

function ensureRedisInfraStarted(): void {
  if (redisInfraStarted) return;
  redisInfraStarted = true;

  startInstrumentation(() => getRedisConnection());
  usageProtectionReadyPromise = startUsageProtection(() => getRedisConnection());
  startQueueReportFlush(
    () => getRedisConnection(),
    () => getMetricsReport().opsPerMin,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startMetricsPersistence(
    () => getRedisConnection() as any,
    getSystemMetrics,
    (metrics) => { try { return estimateCost(metrics); } catch { return null; } },
  );
}

function getRedisConnection(): IORedis {

  if (!redisConnection) {
    // Raw options ALWAYS: this constructs the shared instance itself —
    // routing through getConnectionConfig() would recurse under W2-7.
    redisConnection = new IORedis(rawConnectionOptions());

    redisConnection.on('error', (err) => {
      if (isNonRecoverableRedisError(err)) {
        redisNonRecoverableFailures++;
        if (redisNonRecoverableFailures >= 2) {
          console.error(JSON.stringify({
            level: 'ERROR',
            event: 'redis_non_recoverable_connection_error',
            host: redisConfig.host,
            message: (err as Error)?.message,
          }));
          redisConnection?.disconnect(false);
        }
      }
      if (IS_OPTIONAL_LOCAL_REDIS) {
        redisUnavailable = true;
      } else {
        // Non-local (Upstash/managed): escalate clearly instead of masking
        // an infinite silent reconnect. Loud on first failure and every
        // 10th thereafter, bypassing the 30s info-log cooldown.
        redisConsecutiveFailures++;
        if (redisConsecutiveFailures === 1 || redisConsecutiveFailures % 10 === 0) {
          console.error(JSON.stringify({
            level: 'ERROR',
            event: 'redis_connection_unhealthy',
            host: redisConfig.host,
            tls: !!redisConfig.tls,
            consecutiveFailures: redisConsecutiveFailures,
            message: (err as Error)?.message,
          }));
        }
      }
      logRedisErrorOnce(err);
    });

    redisConnection.on('connect', () => {
      console.log('✅ Redis connected');
      redisUnavailable = false;
      redisConsecutiveFailures = 0;
      redisNonRecoverableFailures = 0;
      ensureRedisInfraStarted();
    });

    redisConnection.connect().catch((err) => {
      if (IS_OPTIONAL_LOCAL_REDIS) {
        redisUnavailable = true;
      } else {
        redisConsecutiveFailures++;
        console.error(JSON.stringify({
          level: 'ERROR',
          event: 'redis_initial_connect_failed',
          host: redisConfig.host,
          tls: !!redisConfig.tls,
          message: (err as Error)?.message,
        }));
      }
      logRedisErrorOnce(err);
    });
  }
  return redisConnection;
}

/**
 * Shared Redis client — use this in ALL services (cache, metrics, strategy index).
 * Singleton: one connection per process, reused across imports.
 * Never call .quit() on this — it is long-lived.
 */
export function getSharedRedisClient(): IORedis {
  return getRedisConnection();
}

// ── Heavy-job in-process coordination ─────────────────────────────────────────
//
// A minimal, fair (FIFO) async counting semaphore SHARED across heavy job
// types (ai-heavy, creator-render) so their combined in-flight count cannot
// explode CPU/memory and OOM the Railway worker. In-process only — NO Redis,
// NO global/external infra. Each queue keeps its own BullMQ concurrency; this
// only bounds the *union* of opted-in heavy processors. Not a system-wide
// serializer (light queues never call this).
const HEAVY_JOB_CONCURRENCY = (() => {
  const o = Number(config.HEAVY_JOB_CONCURRENCY);
  return Number.isInteger(o) && o >= 1 && o <= 8 ? o : 3;
})();
let _heavyActive = 0;
const _heavyWaiters: Array<() => void> = [];

function acquireHeavySlot(): Promise<void> {
  if (_heavyActive < HEAVY_JOB_CONCURRENCY) {
    _heavyActive++;
    return Promise.resolve();
  }
  // FIFO queue → fairness; resolver is called by releaseHeavySlot().
  return new Promise<void>((resolve) => { _heavyWaiters.push(resolve); });
}

function releaseHeavySlot(): void {
  const next = _heavyWaiters.shift();
  if (next) {
    // Hand the slot directly to the next waiter; _heavyActive unchanged.
    next();
    return;
  }
  _heavyActive = Math.max(0, _heavyActive - 1);
}

/**
 * Run `fn` while holding one shared heavy-job slot. Acquire→finally-release
 * guarantees no slot leak / no deadlock even if `fn` throws. Preserves the
 * caller's result and error semantics (BullMQ retry behavior unchanged).
 */
export async function withHeavyJobSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireHeavySlot();
  try {
    return await fn();
  } finally {
    releaseHeavySlot();
  }
}

/**
 * Feature-tagged Redis client. Wraps the shared connection in an instrumentation
 * proxy that records every command under `feature` for ops reporting.
 * All calls still use the same underlying IORedis connection.
 */
export function getInstrumentedClient(feature: RedisFeature | string): IORedis {
  return createInstrumentedClient(getRedisConnection(), feature);
}

// Usage protection readiness is now lazy and starts only when Redis-backed
// queue/worker functionality is used.
export function getUsageProtectionReady(): Promise<void> {
  getRedisConnection();
  if (redisUnavailable && IS_OPTIONAL_LOCAL_REDIS) {
    return Promise.resolve();
  }
  return usageProtectionReadyPromise;
}

// ── Usage-protection queue guard ──────────────────────────────────────────────
//
// Patches `.add()` and `.addBulk()` on a Queue so that:
//   - Non-essential queues are blocked entirely at critical usage (isQueueAllowed)
//   - Bulk fan-out is capped by getQueueFanOutMultiplier() at throttle level
//
// Critical queues (posting, publish) are never blocked.

export function applyQueueProtection(queue: Queue): Queue {
  const origAdd     = queue.add.bind(queue);
  const origAddBulk = queue.addBulk.bind(queue);

  // Register drain callback so the overflow buffer is flushed back into this
  // queue when the protection level recovers to normal.  Uses the original
  // (unpatched) addBulk so the drain bypasses the guard and always succeeds.
  registerOverflowDrain(queue.name, async (_queueName, jobs) => {
    if (jobs.length > 0) await origAddBulk(jobs as Parameters<typeof origAddBulk>[0]);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).add = async (...args: any[]) => {
    if (!isQueueAllowed(queue.name)) {
      const entry: OverflowEntry = { name: args[0] as string, data: args[1], opts: args[2] };
      const stored = storeOverflow(queue.name, entry);
      console.error(JSON.stringify({
        level:   'ERROR',
        event:   stored ? 'queue_job_overflowed' : 'queue_job_dropped',
        queue:   queue.name,
        job:     args[0],
        stored,
        reason:  'critical_redis_usage',
      }));
      return null;
    }
    return origAdd(...args);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).addBulk = async (...args: any[]) => {
    const jobs: OverflowEntry[] = args[0];

    if (!isQueueAllowed(queue.name)) {
      // Store all blocked bulk jobs in the overflow buffer
      let storedCount = 0;
      for (const j of jobs) {
        const stored = storeOverflow(queue.name, j as OverflowEntry);
        if (stored) storedCount++;
      }
      console.error(JSON.stringify({
        level:   'ERROR',
        event:   'queue_bulk_overflowed',
        queue:   queue.name,
        total:   jobs.length,
        stored:  storedCount,
        dropped: jobs.length - storedCount,
        reason:  'critical_redis_usage',
      }));
      return [];
    }

    // Throttle: cap fan-out to the configured multiplier
    const mult   = getQueueFanOutMultiplier();
    const capped = mult < 1 ? jobs.slice(0, Math.max(1, Math.ceil(jobs.length * mult))) : jobs;
    if (capped.length < jobs.length) {
      const deferred = jobs.slice(capped.length);
      let storedCount = 0;
      for (const j of deferred) {
        const stored = storeOverflow(queue.name, j as OverflowEntry);
        if (stored) storedCount++;
      }
      console.warn(JSON.stringify({
        level:    'WARN',
        event:    'queue_bulk_fan_out_reduced',
        queue:    queue.name,
        original: jobs.length,
        sent:     capped.length,
        deferred: deferred.length,
        stored:   storedCount,
        reason:   'throttle_redis_usage',
      }));
    }
    return origAddBulk(capped as typeof jobs);
  };

  return queue;
}

// Queue instance for enqueuing jobs
let publishQueue: Queue | null = null;
let engagementPollingQueue: Queue | null = null;
let leadThreadRecomputeQueue: Queue | null = null;
let conversationMemoryRebuildQueue: Queue | null = null;

// ── RISK 1: Priority queues (separate AI-heavy from time-critical posting) ────
let aiHeavyQueue: Queue | null = null;
let postingQueue: Queue | null = null;

/**
 * High-priority queue for time-critical publishing operations.
 * Never blocked by AI generation jobs.
 */
export function getPostingQueue(): Queue {
  if (!postingQueue) {
    postingQueue = new Queue('posting', {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        priority: 1, // lower number = higher priority in BullMQ
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    postingQueue.on('error', (err) => {
      console.error('Posting queue error:', err);
    });
    instrumentQueue(postingQueue);
    applyQueueProtection(postingQueue);
  }
  return postingQueue;
}

/**
 * Low-priority queue for AI-heavy operations (blueprint, campaign plan, etc.).
 * Won't starve the posting queue even under heavy AI load.
 */
export function getAiHeavyQueue(): Queue {
  if (!aiHeavyQueue) {
    aiHeavyQueue = new Queue('ai-heavy', {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        priority: 10, // lower priority than posting
        removeOnComplete: { age: 12 * 3600, count: 200 },
        removeOnFail: { age: 3 * 24 * 3600 },
      },
    });
    aiHeavyQueue.on('error', (err) => {
      console.error('AI-heavy queue error:', err);
    });
    instrumentQueue(aiHeavyQueue);
    applyQueueProtection(aiHeavyQueue);
  }
  return aiHeavyQueue;
}

/**
 * Get or create the engagement-polling queue instance.
 * attempts: 1, no retry (runs again next interval).
 */
export function getEngagementPollingQueue(): Queue {
  if (!engagementPollingQueue) {
    engagementPollingQueue = new Queue('engagement-polling', {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        // Retry transient API failures (platform pagination timeout,
        // brief 502 / 429 from social platform APIs). attempts=1 was
        // silent-data-loss for the polling window: a single transient
        // error dropped the entire hour's batch with no recovery.
        // 3 attempts × exponential backoff (30s, 60s, 120s) = ~210s
        // worst-case wall time, safely under the hourly cron interval
        // — no overlap, no retry storm. ingestComments is idempotent
        // (dedups by platform comment id), so replay cannot duplicate
        // ingestion state.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    engagementPollingQueue.on('error', (err) => {
      console.error('Engagement polling queue error:', err);
    });
    instrumentQueue(engagementPollingQueue);
    applyQueueProtection(engagementPollingQueue);
  }
  return engagementPollingQueue;
}

/**
 * Event-driven queue for lead thread score recomputes.
 * Replaces the 5-second polling loop in cron.ts.
 * Jobs are deduplicated: a fixed jobId + 200 ms delay coalesces bursts.
 * attempts: 1, removeOnComplete immediately so jobId is freed for next event.
 */
export function getLeadThreadRecomputeQueue(): Queue {
  if (!leadThreadRecomputeQueue) {
    leadThreadRecomputeQueue = new Queue('lead-thread-recompute', {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    leadThreadRecomputeQueue.on('error', (err) => {
      console.error('[lead-thread-recompute] queue error:', err);
    });
    instrumentQueue(leadThreadRecomputeQueue);
    applyQueueProtection(leadThreadRecomputeQueue);
  }
  return leadThreadRecomputeQueue;
}

/**
 * Event-driven queue for conversation memory rebuilds.
 * Replaces the 10-second polling loop in cron.ts.
 * Jobs are deduplicated: a fixed jobId + 200 ms delay coalesces bursts.
 * attempts: 1, removeOnComplete immediately so jobId is freed for next event.
 */
export function getConversationMemoryRebuildQueue(): Queue {
  if (!conversationMemoryRebuildQueue) {
    conversationMemoryRebuildQueue = new Queue('conversation-memory-rebuild', {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    conversationMemoryRebuildQueue.on('error', (err) => {
      console.error('[conversation-memory-rebuild] queue error:', err);
    });
    instrumentQueue(conversationMemoryRebuildQueue);
    applyQueueProtection(conversationMemoryRebuildQueue);
  }
  return conversationMemoryRebuildQueue;
}

/**
 * Get or create the publish queue instance
 * Note: BullMQ v5+ handles delayed jobs automatically, no QueueScheduler needed
 */
export function getQueue(): Queue {
  if (!publishQueue) {
    const queueName = 'publish';
    
    publishQueue = new Queue(queueName, {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      defaultJobOptions: {
        // BETA-004 (RULE 4): retry transient publish failures (429/502/network) instead
        // of losing the post permanently. The processor was already built for this
        // (queue_jobs.status idempotency guard + attemptsMade + retryOwner:'external'),
        // so enabling attempts here is the smallest production-safe fix. Exponential
        // backoff (~1m, 2m) matches the processor's own next_retry_at intent.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    });

    publishQueue.on('error', (err) => {
      console.error('Queue error:', err);
    });
    instrumentQueue(publishQueue);
    applyQueueProtection(publishQueue);
  }
  return publishQueue;
}

/**
 * Create a worker instance for processing jobs
 *
 * @param queueName - Name of the queue (default: 'publish')
 * @param processor - Function to process jobs
 * @param opts - Optional: concurrency (default 5)
 */
export function getWorker(
  queueName: string = 'publish',
  processor: (job: any) => Promise<void>,
  opts?: { concurrency?: number; stalledInterval?: number; maxStalledCount?: number }
): Worker {
  const concurrency = opts?.concurrency ?? 5;
  // Per-queue stalled-recovery cadence. The 30-minute default below is a
  // deliberate Redis-cost choice and stays the default for every queue that
  // does not opt out; a queue whose jobs hold user-visible state for minutes
  // (bolt-execution) can pay for a faster cadence WITHOUT changing any other
  // queue's footprint. A live job is never mis-detected: BullMQ renews a job's
  // lock on a timer for as long as the process is alive, and BOLT awaits
  // network I/O, so the event loop stays free to renew.
  const stalledInterval = opts?.stalledInterval ?? 1_800_000;
  // F-02 (Foundation Batch A): run every job inside a RequestContext seeded
  // from the job's trace metadata (or its identity). Purely additive ALS
  // scoping — fail-safe, never alters job execution or results.
  const tracedProcessor = (job: any) => runWithJobTraceContext(job, () => processor(job));
  const worker = new Worker(queueName, tracedProcessor, {
    connection: getRedisConnection(),
    prefix: getQueuePrefix(),
    concurrency,
    limiter: {
      max: 10,
      duration: 1000,
    },
    // Reduce idle Redis polling — default drainDelay=5s × 8 workers = ~138k cmds/day.
    // 300s drainDelay + 30-min stalledInterval keeps this under ~2.7k cmds/day.
    drainDelay: 300,
    stalledInterval,
    ...(opts?.maxStalledCount !== undefined ? { maxStalledCount: opts.maxStalledCount } : {}),
  });

  worker.on('completed', (job) => {
    // W0-6: per-job success logs are metrics-covered (instrumentWorker /
    // recordQueueJob); the console line is opt-in to cut steady-state noise
    // and event-loop tax on the single worker. Failures still always log.
    if (/^(1|true|yes|on)$/i.test(String(process.env.WORKER_VERBOSE_LOGS ?? ''))) {
      console.log(`✅ Job ${job.id} completed`);
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
    deadLetterOnExhaustion(queueName, job, err);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  instrumentWorker(worker);
  return worker;
}

/**
 * Create engagement-polling worker (concurrency 1).
 * Processes jobs that run engagement ingestion for recently published posts.
 */
export function getEngagementPollingWorker(): Worker {
  const worker = new Worker(
    'engagement-polling',
    async (job) => runWithJobTraceContext(job, async () => {
      const { processEngagementPollingJob } = await import('./jobProcessors/engagementPollingProcessor');
      await processEngagementPollingJob();
    }),
    {
      connection: getRedisConnection(),
      prefix: getQueuePrefix(),
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Engagement polling job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Engagement polling job ${job?.id} failed:`, err.message);
    deadLetterOnExhaustion('engagement-polling', job, err);
  });

  worker.on('error', (err) => {
    console.error('Engagement polling worker error:', err);
  });

  instrumentWorker(worker);
  return worker;
}

/**
 * Gracefully close Redis connections
 */
export async function closeConnections(): Promise<void> {
  if (publishQueue) {
    await publishQueue.close();
    publishQueue = null;
  }
  if (engagementPollingQueue) {
    await engagementPollingQueue.close();
    engagementPollingQueue = null;
  }
  if (postingQueue) {
    await postingQueue.close();
    postingQueue = null;
  }
  if (aiHeavyQueue) {
    await aiHeavyQueue.close();
    aiHeavyQueue = null;
  }
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

/**
 * Create a new queue instance (alternative API matching user examples)
 * 
 * @param name - Queue name
 * @returns Queue instance (BullMQ v5+ handles delayed jobs automatically)
 */
export function createQueue(name: string): Queue {
  // Note: BullMQ v5+ handles delayed jobs automatically, no QueueScheduler needed
  
  const q = new Queue(name, {
    connection: getRedisConnection(),
    prefix: getQueuePrefix(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
    },
  });
  instrumentQueue(q);
  applyQueueProtection(q);  // BUG#9 fix: all queues must be protected
  return q;
}

/**
 * Create a new worker instance (alternative API matching user examples)
 * 
 * @param name - Queue name
 * @param processorPathOrFn - Processor function or module path
 * @param opts - Optional configuration (concurrency, etc.)
 * @returns Worker instance
 */
export function createWorker(
  name: string,
  processorPathOrFn: string | ((job: any) => Promise<void>),
  opts?: { concurrency?: number }
): Worker {
  const concurrency = opts?.concurrency ?? 5;
  
  if (typeof processorPathOrFn !== 'function') {
    throw new Error(
      `createWorker: processor must be a function, got string "${processorPathOrFn}". ` +
      'Use a dynamic import inside the processor function instead of a file path.'
    );
  }
  const processor = processorPathOrFn;

  // Same trace restoration getWorker() applies — without it, jobs enqueued
  // through safeEnqueue carry `_trace` that this factory would discard.
  const tracedProcessor = (job: any) => runWithJobTraceContext(job, () => processor(job));
  const worker = new Worker(name, tracedProcessor as any, {
    connection: getRedisConnection(),
    prefix: getQueuePrefix(),
    concurrency,
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('failed', (job, err) => {
    console.error(JSON.stringify({
      event: 'job_failed',
      jobId: job?.id,
      name: job?.name,
      err: err?.message,
    }));
    deadLetterOnExhaustion(name, job, err);
  });

  worker.on('completed', (job) => {
    console.info(JSON.stringify({
      event: 'job_completed',
      jobId: job.id,
      name: job.name,
    }));
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  // Graceful shutdown helper
  const shutdown = async () => {
    console.info('Shutting down worker...');
    await worker.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  instrumentWorker(worker);
  return worker;
}

/**
 * GAP 3: Generate a stable, content-addressed jobId.
 *
 * BullMQ silently ignores `queue.add()` calls when a job with the same jobId
 * already exists in waiting/active/delayed state. This prevents:
 *  - Duplicate clicks enqueuing the same work twice
 *  - Cron overlap (two scheduler cycles adding the same job)
 *  - Retry storms re-enqueuing an already-queued job
 *
 * Usage:
 *   const jobId = makeStableJobId('publish', { postId, scheduledFor });
 *   await queue.add('publish', payload, { jobId });
 *
 * @param prefix  - Queue/job name (e.g. 'publish', 'intelligence-poll')
 * @param payload - Job payload object; keys are sorted before hashing
 */
export function makeStableJobId(prefix: string, payload: Record<string, unknown>): string {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256').update(`${prefix}:${sorted}`).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}
