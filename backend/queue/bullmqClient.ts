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

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis connection options
function parseRedisUrl(url: string) {
  if (url.includes('://')) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379'),
      password: parsed.password || undefined,
    };
  }
  return {
    host: 'localhost',
    port: 6379,
    password: undefined,
  };
}

const redisConfig = parseRedisUrl(REDIS_URL);

// Redis connection instance (shared across Queue/Worker)
let redisConnection: IORedis | null = null;

function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    redisConnection.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redisConnection.on('connect', () => {
      console.log('✅ Redis connected:', REDIS_URL);
    });
  }
  return redisConnection;
}

// Queue instance for enqueuing jobs
let publishQueue: Queue | null = null;

/**
 * Get or create the publish queue instance
 * Note: BullMQ v5+ handles delayed jobs automatically, no QueueScheduler needed
 */
export function getQueue(): Queue {
  if (!publishQueue) {
    const connection = getRedisConnection();
    const queueName = 'publish';
    
    publishQueue = new Queue(queueName, {
      connection: {
        host: redisConfig.host,
        port: redisConfig.port,
        password: redisConfig.password,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 minute initial delay
        },
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
 */
export function getWorker(
  queueName: string = 'publish',
  processor: (job: any) => Promise<void>
): Worker {
  const connection = getRedisConnection();
  const worker = new Worker(queueName, processor, {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    },
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000, // Per second
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
 * Gracefully close Redis connections
 */
export async function closeConnections(): Promise<void> {
  if (publishQueue) {
    await publishQueue.close();
    publishQueue = null;
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
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    },
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
  
  const processor = typeof processorPathOrFn === 'function'
    ? processorPathOrFn
    : processorPathOrFn;
  
  const worker = new Worker(name, processor as any, {
    connection: {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    },
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

