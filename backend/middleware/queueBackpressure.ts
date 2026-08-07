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
 *   await safeEnqueue(queue, 'publish', 'publish', payload, { jobId });
 *
 * ── Exempt paths (MUST keep calling queue.add directly) ──────────────────────
 * Backpressure exists to shed NEW tenant-driven work. Three classes of enqueue
 * are recovery paths, where shedding would destroy the thing being recovered:
 *
 *   1. Dead-letter republication (leadQueueHardening, creatorRenderDurableQueue)
 *      — a full queue would silently DROP the dead letter, which is the only
 *      durable record that the job failed.
 *   2. Operator requeue from the DLQ (services/jobInspection) — an operator
 *      draining a backlog would be blocked by the backlog itself.
 *   3. Soak/diagnostic harnesses (scripts/) — not production enqueues.
 *
 * These are enumerated in backend/tests/unit/queueBackpressureAdoption.test.ts,
 * which fails on any NEW direct queue.add outside that list.
 */

import type { JobsOptions, Queue } from 'bullmq';

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
/**
 * safeEnqueue for callers that CANNOT degrade — they must return a job id to
 * their caller (the content/creator adapters return `{ jobId, pollUrl }`), so
 * there is no meaningful "shed" response they can produce.
 *
 * Throws QueueFullError instead of returning null. That is the honest shed
 * path for these sites: the caller already propagates enqueue failures, and a
 * silent null would surface later as a broken poll URL rather than an error at
 * the point of failure.
 */
export async function enqueueOrThrow<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts?: JobsOptions & { softLimit?: number; hardLimit?: number },
): Promise<{ id?: string | null }> {
  const job = await safeEnqueue(queue, queueName, jobName, payload, opts);
  if (!job) {
    throw new QueueFullError(queueName, await getQueueDepth(queue).catch(() => -1), opts?.hardLimit ?? HARD_LIMIT);
  }
  return job;
}

export async function safeEnqueue<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts?: JobsOptions & { softLimit?: number; hardLimit?: number },
): Promise<{ id?: string | null } | null> {
  try {
    await assertQueueHasCapacity(queue, queueName, opts);
    // W0-3 (trace adoption): stamp the caller's trace context onto the job
    // payload (additive `_trace` field; absent when no context is active).
    // The worker-side getWorker() factory restores it into the RequestContext
    // ALS, linking api → queue → worker series.
    const { withTraceMeta } = await import('../observability/traceKit');
    // The FULL JobsOptions is forwarded. This helper previously whitelisted
    // only jobId/delay/priority, which silently dropped attempts, backoff and
    // removeOnComplete/removeOnFail — so adopting it at a call site that set
    // those would have quietly disabled that job's retry policy (the lead
    // enqueue in pages/api/leads/job/create.ts being the clearest case).
    // softLimit/hardLimit are backpressure-only knobs and must not reach BullMQ.
    const { softLimit: _s, hardLimit: _h, ...jobOptions } = opts ?? {};
    void _s; void _h;
    const job = await queue.add(jobName, withTraceMeta(payload), jobOptions);
    return { id: job.id };
  } catch (err) {
    if (err instanceof QueueFullError) {
      return null; // Caller can decide to retry later
    }
    throw err;
  }
}
