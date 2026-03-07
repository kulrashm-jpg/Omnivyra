/**
 * Intelligence Polling Queue — BullMQ queue for background API signal polling.
 * Feeds the Unified Intelligence Signal Store via workers.
 *
 * Env: REDIS_URL or REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 */

import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

function getConnection(): { host: string; port: number; password?: string } {
  if (REDIS_URL && REDIS_URL.includes('://')) {
    const parsed = new URL(REDIS_URL);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
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
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    intelligencePollingQueue.on('error', (err) => {
      console.error('[intelligence-polling] queue error', err);
    });
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
  await queue.add('poll', payload, {
    jobId,
    priority,
    ...DEFAULT_JOB_OPTIONS,
  });
  return jobId;
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
