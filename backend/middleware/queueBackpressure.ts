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
import { getProtectedAdd } from '../queue/protectedAdd';

const SOFT_LIMIT = 500;
const HARD_LIMIT = 2_000;

export class QueueFullError extends Error {
  /** Depth observed when the job was refused (-1 when unknown). */
  readonly depth: number;
  readonly limit: number;
  constructor(queueName: string, depth: number, limit: number) {
    super(`Queue "${queueName}" is full (depth=${depth}, limit=${limit}). Job rejected.`);
    this.name = 'QueueFullError';
    this.depth = depth;
    this.limit = limit;
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

// ─────────────────────────────────────────────────────────────────────────────
// OPS-C: explicit enqueue outcome contract
// ─────────────────────────────────────────────────────────────────────────────
//
// Production 2026-10-30: under `critical_redis_usage` the usage guard
// (applyQueueProtection) makes `queue.add` return null after parking the job
// in the overflow buffer. safeEnqueue then read `job.id` of that null and
// threw `TypeError: Cannot read properties of null (reading 'id')` — from
// every producer of every non-critical queue — while the parked job was still
// replayed later. Callers saw a crash for work that would in fact run.
//
// Every outcome is now explicit:
//
//   status                    in Redis  pending   retry owner
//   enqueued                  yes       —         —
//   deduplicated              no        yes       nobody: an identical jobId is
//                                                 already parked and will run
//   deferred_overflow_stored  no        yes       the overflow drain (in-process;
//                                                 lost if the process restarts)
//   rejected_backpressure     no        no        the caller (queue depth ≥ hard)
//   rejected_redis_critical   no        no        the caller (parked job retracted)
//   dropped_overflow_full     no        no        the caller (buffer full)
//   unavailable               no        no        the caller (Redis connection)
//   failed                    no        no        the caller (any other error)
//
// enqueueWithOutcome never throws. `onDeferred` decides what a parked job
// becomes: 'keep' leaves it for the drain (deferred_overflow_stored);
// 'retract' (the default) takes it back so the caller's "not accepted" answer
// is the whole truth (rejected_redis_critical) — a caller that answers 429 or
// leaves a row for retry must not ALSO have the job replayed later.

export type EnqueueStatus =
  | 'enqueued'
  | 'deduplicated'
  | 'deferred_overflow_stored'
  | 'rejected_backpressure'
  | 'rejected_redis_critical'
  | 'dropped_overflow_full'
  | 'unavailable'
  | 'failed';

export type EnqueueOutcome =
  | { status: 'enqueued'; id: string | null }
  | { status: 'deduplicated'; id: string | null }
  | { status: 'deferred_overflow_stored'; id: string | null }
  | { status: 'rejected_backpressure'; depth: number; limit: number }
  | { status: 'rejected_redis_critical' }
  | { status: 'dropped_overflow_full' }
  | { status: 'unavailable'; errorName: string }
  | { status: 'failed'; errorName: string };

/**
 * OPS-C: thrown by enqueueOrThrow when the job was not accepted for a reason
 * other than queue depth (Redis usage guard at critical, overflow buffer
 * full, deduplicated into a parked job). Extends QueueFullError so every
 * existing `instanceof QueueFullError` shed path treats it the same way.
 */
export class QueueNotAcceptedError extends QueueFullError {
  readonly status: EnqueueStatus;
  constructor(queueName: string, status: EnqueueStatus) {
    super(queueName, -1, HARD_LIMIT);
    this.name = 'QueueNotAcceptedError';
    this.status = status;
    this.message = `Queue "${queueName}" did not accept the job (${status}).`;
  }
}

/** True when the work will run (now, or after the overflow replay) without the caller retrying. */
export function isEnqueuePending(o: EnqueueOutcome): boolean {
  return o.status === 'enqueued' || o.status === 'deduplicated' || o.status === 'deferred_overflow_stored';
}

export type EnqueueOptions = JobsOptions & {
  softLimit?: number;
  hardLimit?: number;
  /** What to do with a job the Redis usage guard parked. Default 'retract'. */
  onDeferred?: 'keep' | 'retract';
};

const CONNECTION_ERROR = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|Connection is closed|connection (is )?closed|Stream isn't writeable|max retries|MaxRetriesPerRequest|enableOfflineQueue|not connected|Redis is unavailable/i;

function classifyError(err: unknown): 'unavailable' | 'failed' {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return CONNECTION_ERROR.test(msg) ? 'unavailable' : 'failed';
}

function errorNameOf(err: unknown): string {
  if (err instanceof Error && typeof err.name === 'string' && err.name) return err.name.slice(0, 64);
  return 'UnknownError';
}

function jobIdOf(opts: JobsOptions | undefined): string | null {
  const id = opts?.jobId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Outcome counter + structured event. Only the queue name, the job NAME and
 * the status are emitted — never the payload, the jobId or tenant ids.
 */
function recordEnqueueOutcome(queueName: string, jobName: string, outcome: EnqueueOutcome): void {
  try {
    // Lazy require keeps this module import-light (web routes load it).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { recordRawCounter } = require('../observability/metrics') as typeof import('../observability/metrics');
    recordRawCounter('queue.enqueue.outcome', 1, { queue: queueName, status: outcome.status });
  } catch { /* fail-safe */ }
  if (outcome.status === 'enqueued') return;
  try {
    const permanent = outcome.status === 'dropped_overflow_full' || outcome.status === 'failed';
    const line = JSON.stringify({
      level: permanent ? 'ERROR' : 'WARN',
      event: 'queue_enqueue_not_accepted',
      queue: queueName,
      job: String(jobName).slice(0, 80),
      status: outcome.status,
      ...(outcome.status === 'rejected_backpressure' ? { depth: outcome.depth, limit: outcome.limit } : {}),
      ...(outcome.status === 'unavailable' || outcome.status === 'failed' ? { error_name: outcome.errorName } : {}),
    });
    if (permanent) console.error(line); else console.warn(line);
  } catch { /* fail-safe */ }
}

async function attemptEnqueue<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts: EnqueueOptions | undefined,
  onError: (err: unknown) => void,
): Promise<EnqueueOutcome> {
  try {
    await assertQueueHasCapacity(queue, queueName, opts);
  } catch (err) {
    if (err instanceof QueueFullError) {
      return { status: 'rejected_backpressure', depth: err.depth, limit: err.limit };
    }
    onError(err);
    return { status: classifyError(err), errorName: errorNameOf(err) };
  }
  try {
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
    // softLimit/hardLimit/onDeferred are helper-only knobs and must not reach BullMQ.
    const { softLimit: _s, hardLimit: _h, onDeferred, ...jobOptions } = opts ?? {};
    void _s; void _h;

    const protectedAdd = getProtectedAdd(queue);
    if (protectedAdd) {
      const r = await protectedAdd(jobName, withTraceMeta(payload), jobOptions as Record<string, unknown>);
      switch (r.kind) {
        case 'added':
          if (!r.job) return { status: 'failed', errorName: 'AddReturnedNull' };
          return { status: 'enqueued', id: r.job.id ?? null };
        case 'overflow_coalesced':
          return { status: 'deduplicated', id: jobIdOf(jobOptions) };
        case 'overflow_dropped':
          return { status: 'dropped_overflow_full' };
        case 'overflow_stored':
          if ((onDeferred ?? 'retract') === 'keep') {
            return { status: 'deferred_overflow_stored', id: jobIdOf(jobOptions) };
          }
          // retract() is false only when the drain replayed the entry between
          // the park and this line (usage recovered meanwhile): the job IS on
          // its way into Redis, so reporting "not accepted" would invite a
          // duplicate from the caller's retry.
          if (!r.retract()) return { status: 'enqueued', id: jobIdOf(jobOptions) };
          return { status: 'rejected_redis_critical' };
        default:
          return { status: 'failed', errorName: 'UnknownProtectedAddResult' };
      }
    }

    // Unprotected queue: a plain add. A null here has no known meaning, so it
    // is a failure — never a TypeError.
    const job = await queue.add(jobName, withTraceMeta(payload), jobOptions);
    if (!job) return { status: 'failed', errorName: 'AddReturnedNull' };
    return { status: 'enqueued', id: (job as { id?: string | null }).id ?? null };
  } catch (err) {
    onError(err);
    return { status: classifyError(err), errorName: errorNameOf(err) };
  }
}

/**
 * Enqueue with an explicit outcome. NEVER throws (see the contract above).
 */
export async function enqueueWithOutcome<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts?: EnqueueOptions,
): Promise<EnqueueOutcome> {
  const outcome = await attemptEnqueue(queue, queueName, jobName, payload, opts, () => { /* reported by status */ });
  recordEnqueueOutcome(queueName, jobName, outcome);
  return outcome;
}

/**
 * safeEnqueue for callers that CANNOT degrade — they must return a job id to
 * their caller (the content/creator adapters return `{ jobId, pollUrl }`), so
 * there is no meaningful "shed" response they can produce.
 *
 * Throws QueueFullError (depth) or QueueNotAcceptedError (a QueueFullError:
 * usage guard at critical, overflow full, deduplicated) instead of returning
 * null. That is the honest shed path for these sites: the caller already
 * propagates enqueue failures, and a silent null would surface later as a
 * broken poll URL rather than an error at the point of failure. A job the
 * usage guard parked is RETRACTED first, so a reported failure is never
 * followed by a replayed execution.
 */
export async function enqueueOrThrow<T extends Record<string, unknown>>(
  queue: Queue,
  queueName: string,
  jobName: string,
  payload: T,
  opts?: JobsOptions & { softLimit?: number; hardLimit?: number },
): Promise<{ id?: string | null }> {
  let cause: unknown;
  const outcome = await attemptEnqueue(queue, queueName, jobName, payload, { ...(opts ?? {}), onDeferred: 'retract' }, (e) => { cause = e; });
  recordEnqueueOutcome(queueName, jobName, outcome);
  switch (outcome.status) {
    case 'enqueued':
      return { id: outcome.id };
    case 'rejected_backpressure':
      throw new QueueFullError(queueName, outcome.depth, outcome.limit);
    case 'unavailable':
    case 'failed':
      throw cause ?? new Error(`enqueue ${outcome.status}: ${outcome.errorName}`);
    default:
      throw new QueueNotAcceptedError(queueName, outcome.status);
  }
}

/**
 * Safe enqueue helper: checks backpressure, then adds the job.
 *
 * Contract (same shape as before, now total):
 *   - `{ id }`  the job is in Redis.
 *   - `null`    the job was NOT accepted and nothing is pending on its
 *               behalf: depth backpressure, the Redis usage guard at critical
 *               (the parked job is retracted), the overflow buffer full, or
 *               an identical jobId already parked (deduplicated — the parked
 *               twin will run, and a retry under the same jobId is a BullMQ
 *               no-op). The caller owns the retry: every null-checking caller
 *               leaves its DB row pending or answers 429 for exactly this.
 *   - throws    only for Redis connection / unexpected errors (unchanged), so
 *               callers' existing catch-and-fallback paths keep working.
 *
 * It never throws a TypeError on a null `queue.add` result (the 2026-10-30
 * production crash). Callers that want a parked job kept for replay, or the
 * full status, use enqueueWithOutcome.
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
  opts?: JobsOptions & { softLimit?: number; hardLimit?: number },
): Promise<{ id?: string | null } | null> {
  let cause: unknown;
  const outcome = await attemptEnqueue(queue, queueName, jobName, payload, { ...(opts ?? {}), onDeferred: 'retract' }, (e) => { cause = e; });
  recordEnqueueOutcome(queueName, jobName, outcome);
  switch (outcome.status) {
    case 'enqueued':
      return { id: outcome.id };
    case 'unavailable':
    case 'failed':
      // Pre-OPS-C behaviour for real errors: rethrow the original error. A
      // failure with no error object (an add that returned null on an
      // unprotected queue) is "not accepted" — null, never a TypeError.
      if (cause !== undefined) throw cause;
      return null;
    default:
      return null;
  }
}
