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
import { getMetricsReport } from '../../lib/redis/instrumentation';
import IORedis from 'ioredis';
import { createHash } from 'crypto';
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

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis connection options — includes TLS for Upstash hosts
function parseRedisUrl(url: string) {
  // Strip any redis-cli command prefix (e.g. "redis-cli --tls -u redis://...")
  const urlMatch = url.match(/rediss?:\/\/\S+/);
  if (urlMatch) url = urlMatch[0];

  if (url.includes('://')) {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const needsTls = host.includes('upstash.io');
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

export function getRedisConfig() {
  return redisConfig;
}

/** Full IORedis-compatible connection options including TLS for Upstash. */
export function getConnectionConfig() {
  return {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    ...(redisConfig.tls ? { tls: redisConfig.tls } : {}),
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  };
}

// Redis connection instance (shared across Queue/Worker)
let redisConnection: IORedis | null = null;

function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      tls: redisConfig.host.includes('upstash.io') ? {} : undefined,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    redisConnection.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redisConnection.on('connect', () => {
      console.log('✅ Redis connected');
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

/**
 * Feature-tagged Redis client. Wraps the shared connection in an instrumentation
 * proxy that records every command under `feature` for ops reporting.
 * All calls still use the same underlying IORedis connection.
 */
export function getInstrumentedClient(feature: RedisFeature | string): IORedis {
  return createInstrumentedClient(getRedisConnection(), feature);
}

// Start instrumentation timers once per process.
// Pass the shared-client factory to avoid a circular import inside the module.
startInstrumentation(() => getRedisConnection());
// Start Redis usage-protection polling (15-second loop).
// BUG#21 fix: store the first-poll promise so startWorkers() can await it before
// accepting any jobs — guarantees protection level is known at worker startup.
export const usageProtectionReady: Promise<void> = startUsageProtection(() => getRedisConnection());
startQueueReportFlush(
  () => getRedisConnection(),
  () => getMetricsReport().opsPerMin,
);

// Start 5-minute system metrics persistence to Redis.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
startMetricsPersistence(
  () => getRedisConnection() as any,
  getSystemMetrics,
  (metrics) => { try { return estimateCost(metrics); } catch { return null; } },
);

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
      connection: getConnectionConfig(),
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
      connection: getConnectionConfig(),
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
    const connection = getRedisConnection();
    engagementPollingQueue = new Queue('engagement-polling', {
      connection: getConnectionConfig(),
      defaultJobOptions: {
        attempts: 1,
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
      connection: getConnectionConfig(),
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
      connection: getConnectionConfig(),
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
    const connection = getRedisConnection();
    const queueName = 'publish';
    
    publishQueue = new Queue(queueName, {
      connection: getConnectionConfig(),
      defaultJobOptions: {
        attempts: 1,
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
  opts?: { concurrency?: number }
): Worker {
  const connection = getRedisConnection();
  const concurrency = opts?.concurrency ?? 5;
  const worker = new Worker(queueName, processor, {
    connection: getConnectionConfig(),
    concurrency,
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
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
    async () => {
      const { processEngagementPollingJob } = await import('./jobProcessors/engagementPollingProcessor');
      await processEngagementPollingJob();
    },
    {
      connection: getConnectionConfig(),
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Engagement polling job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Engagement polling job ${job?.id} failed:`, err.message);
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
  const connection = getRedisConnection();
  
  // Note: BullMQ v5+ handles delayed jobs automatically, no QueueScheduler needed
  
  const q = new Queue(name, {
    connection: getConnectionConfig(),
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
  const connection = getRedisConnection();
  const concurrency = opts?.concurrency ?? 5;
  
  if (typeof processorPathOrFn !== 'function') {
    throw new Error(
      `createWorker: processor must be a function, got string "${processorPathOrFn}". ` +
      'Use a dynamic import inside the processor function instead of a file path.'
    );
  }
  const processor = processorPathOrFn;
  
  const worker = new Worker(name, processor as any, {
    connection: getConnectionConfig(),
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
  return `${prefix}:${hash}`;
}
