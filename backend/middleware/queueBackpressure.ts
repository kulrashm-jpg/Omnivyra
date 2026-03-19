/**
 * Queue Backpressure — RISK 4
 *
 * Prevents queue flooding by checking queue depth before accepting new jobs.
 * If the queue is too deep, new low-priority jobs are rejected with a 429-style error.
 *
 * Thresholds:
 *   SOFT_LIMIT (500 jobs)  — warn, but still accept
 *   HARD_LIMIT (2000 jobs) — reject outright
 *
 * Usage:
 *   await assertQueueHasCapacity(queue, 'publish');
 *   await queue.add('publish', payload, { jobId });
 */

import type { Queue } from 'bullmq';

const SOFT_LIMIT = 500;
const HARD_LIMIT = 2_000;

export class QueueFullError extends Error {
  constructor(queueName: string, depth: number, limit: number) {
    super(`Queue "${queueName}" is full (depth=${depth}, limit=${limit}). Job rejected.`);
    this.name = 'QueueFullError';
  }
}

/**
 * Get combined waiting + active job count for a queue.
 */
export async function getQueueDepth(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
}

/**
 * Throws QueueFullError if the queue is at or above HARD_LIMIT.
 * Logs a warning at SOFT_LIMIT.
 *
 * @param queue     - BullMQ Queue instance
 * @param queueName - Human-readable name for logging
 * @param options   - Optional: override soft/hard limits
 */
export async function assertQueueHasCapacity(
  queue: Queue,
  queueName: string,
  options?: { softLimit?: number; hardLimit?: number },
): Promise<void> {
  const soft = options?.softLimit ?? SOFT_LIMIT;
  const hard = options?.hardLimit ?? HARD_LIMIT;

  let depth: number;
  try {
    depth = await getQueueDepth(queue);
  } catch {
    // If we can't check depth, allow the job (fail open)
    return;
  }

  if (depth >= hard) {
    console.error('[backpressure] hard limit reached', { queue: queueName, depth, hard });
    throw new QueueFullError(queueName, depth, hard);
  }

  if (depth >= soft) {
    console.warn('[backpressure] soft limit warning', { queue: queueName, depth, soft });
  }
}

/**
 * Safe enqueue helper: checks backpressure, then adds the job.
 * Returns the job or null if the queue is full.
 *
 * @param queue     - BullMQ Queue
 * @param queueName - Human-readable name
 * @param jobName   - Job type name
 * @param payload   - Job data
 * @param opts      - BullMQ job options (jobId, delay, etc.)
 */
export async function safeEnqueue<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts?: {
    jobId?: string;
    delay?: number;
    priority?: number;
    softLimit?: number;
    hardLimit?: number;
  },
): Promise<{ id?: string | null } | null> {
  try {
    await assertQueueHasCapacity(queue, queueName, opts);
    const job = await queue.add(jobName, payload, {
      jobId: opts?.jobId,
      delay: opts?.delay,
      priority: opts?.priority,
    });
    return { id: job.id };
  } catch (err) {
    if (err instanceof QueueFullError) {
      return null; // Caller can decide to retry later
    }
    throw err;
  }
}
