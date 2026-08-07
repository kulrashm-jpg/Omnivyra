/**
 * Intelligence Polling Queue — BullMQ queue for background API signal polling.
 * Feeds the Unified Intelligence Signal Store via workers.
 *
 * Env: REDIS_URL or REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 */

import { Queue } from 'bullmq';
import { applyQueueProtection, getQueuePrefix } from './bullmqClient';
import { instrumentQueue } from './queueInstrumentation';
import { enqueueOrThrow } from '../middleware/queueBackpressure';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

function getConnection() {
  if (REDIS_URL && REDIS_URL.includes('://')) {
    const parsed = new URL(REDIS_URL);
    const needsTls = parsed.hostname.includes('upstash.io');
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      ...(needsTls ? { tls: {} } : {}),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    };
  }
  return { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };
}

const QUEUE_NAME = 'intelligence-polling';

/** Job payload for intelligence polling */
export type IntelligencePollingJobPayload = {
  apiSourceId: string;
  companyId?: string | null;
  purpose?: string;
};

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 60_000, // 1 minute base
  },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

let intelligencePollingQueue: Queue | null = null;

/**
 * Get or create the intelligence-polling queue.
 * Supports priority, retry, exponential backoff, and rate limiting (via worker concurrency).
 */
export function getIntelligencePollingQueue(): Queue {
  if (!intelligencePollingQueue) {
    const connection = getConnection();
    intelligencePollingQueue = new Queue(QUEUE_NAME, {
      connection,
      prefix: getQueuePrefix(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    intelligencePollingQueue.on('error', (err) => {
      console.error('[intelligence-polling] queue error', err);
    });
    instrumentQueue(intelligencePollingQueue);
    applyQueueProtection(intelligencePollingQueue);  // BUG#10 fix
  }
  return intelligencePollingQueue;
}

/**
 * Add one intelligence polling job.
 * @param payload apiSourceId, optional companyId, optional purpose
 * @param opts priority 1 = HIGH, 5 = MEDIUM, 10 = LOW (default 5)
 */
export async function addIntelligencePollingJob(
  payload: IntelligencePollingJobPayload,
  opts?: { priority?: number; jobId?: string }
): Promise<string> {
  const queue = getIntelligencePollingQueue();
  const priority = opts?.priority ?? 5;
  const jobId = opts?.jobId ?? `intel-poll-${payload.apiSourceId}-${Date.now()}`;
  // enqueueOrThrow: this function's contract is to RETURN the queued jobId, so
  // a silent shed would hand the caller an id for a job that does not exist.
  await enqueueOrThrow(queue, 'intelligence-polling', 'poll', payload, {
    jobId,
    priority,
    ...DEFAULT_JOB_OPTIONS,
  });
  return jobId;
}

/**
 * HARDEN-004: add many polling jobs in ONE pipelined round-trip. Identical
 * payloads/jobIds/options to calling addIntelligencePollingJob per item —
 * addBulk preserves array order.
 */
export async function addIntelligencePollingJobsBulk(
  items: Array<{ payload: IntelligencePollingJobPayload; priority?: number; jobId?: string }>
): Promise<string[]> {
  if (items.length === 0) return [];
  const queue = getIntelligencePollingQueue();
  const jobs = items.map((item) => ({
    name: 'poll',
    data: item.payload,
    opts: {
      jobId: item.jobId ?? `intel-poll-${item.payload.apiSourceId}-${Date.now()}`,
      priority: item.priority ?? 5,
      ...DEFAULT_JOB_OPTIONS,
    },
  }));
  await queue.addBulk(jobs);
  return jobs.map((j) => j.opts.jobId as string);
}

/**
 * Close the queue connection (e.g. on shutdown).
 */
export async function closeIntelligencePollingQueue(): Promise<void> {
  if (intelligencePollingQueue) {
    await intelligencePollingQueue.close();
    intelligencePollingQueue = null;
  }
}
