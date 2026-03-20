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
import IORedis from 'ioredis';
import { createHash } from 'crypto';

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

// Queue instance for enqueuing jobs
let publishQueue: Queue | null = null;
let engagementPollingQueue: Queue | null = null;

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
  }
  return engagementPollingQueue;
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
  
  return new Queue(name, {
    connection: getConnectionConfig(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
    },
  });
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
