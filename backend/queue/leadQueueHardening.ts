/**
 * Phase 0 — Lead queue hardening (parallel module).
 *
 * Lives alongside leadQueue.ts so the existing production queue config is
 * untouched. Provides:
 *   - Hardened JobsOptions (retries, exponential backoff, longer fail retention)
 *   - Dead-letter queue (`lead-jobs-dlq`)
 *   - Structured failure metadata builder
 *   - Retry-safe idempotency-key helper for BullMQ jobId
 *   - Lightweight queue-health snapshot
 *
 * ACTIVATION STATUS — all three steps are live. The original Phase 0 plan named
 * leadQueue.ts, which W1-4 later deleted (see the note at the foot of this
 * file); live lead jobs run on `engine-jobs`, so activation landed there:
 *   1. Hardened defaults — applied at the enqueue site,
 *      pages/api/leads/job/create.ts (`...leadQueueHardenedDefaults`).
 *   2. Failure metadata + DLQ producer — the `engine-jobs` worker's `failed`
 *      handler in startWorkers.ts builds the metadata, logs it every attempt,
 *      and republishes to `lead-jobs-dlq` once attempts are exhausted.
 *   3. Retry-safe dedup — the same enqueue site passes
 *      `jobId: buildLeadJobIdempotencyKey(...)`.
 *
 * DLQ depth is reported by getLeadQueueObservabilitySnapshot().dead_letter.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { createHash } from 'crypto';
import { getQueuePrefix, getSharedRedisClient } from './bullmqClient';

const LEAD_QUEUE_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.LEAD_QUEUE_ATTEMPTS || '5', 10),
);
const LEAD_QUEUE_BACKOFF_DELAY_MS = Math.max(
  1000,
  parseInt(process.env.LEAD_QUEUE_BACKOFF_DELAY_MS || '60000', 10),
);

export const LEAD_DLQ_NAME = 'lead-jobs-dlq' as const;

export const leadQueueHardenedDefaults: JobsOptions = {
  attempts: LEAD_QUEUE_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: LEAD_QUEUE_BACKOFF_DELAY_MS,
  },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    // 14 days so operators can inspect failure metadata before cleanup.
    age: 14 * 24 * 3600,
  },
};

// W1-4: the DLQ is now LAZY (was a module-level Queue that opened its own
// Redis connection at import time — the orphaned lead-jobs connection bug
// class) and rides the shared client (F-06 convergence direction). Callers:
// leadQueueObservability snapshot + future DLQ producers.
let _leadDeadLetterQueue: Queue | null = null;
export function getLeadDeadLetterQueue(): Queue {
  if (_leadDeadLetterQueue) return _leadDeadLetterQueue;
  _leadDeadLetterQueue = new Queue(LEAD_DLQ_NAME, {
    connection: getSharedRedisClient(),
    prefix: getQueuePrefix(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 30 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
  return _leadDeadLetterQueue;
}

/**
 * Attach the LEAD failure handler to an `engine-jobs` worker.
 *
 * Exported so BOTH bootstraps — startWorkers.ts (dev) and workers/main.ts
 * (production) — attach IDENTICAL behaviour. Previously only the dev bootstrap
 * had any LEAD failure handling, so the production worker emitted nothing on a
 * LEAD failure: no metadata, no dead letter. That prod↔dev divergence is the
 * exact incident class workerTopologyParity.test.ts exists to prevent.
 *
 * Behaviour (unchanged from the original dev-only handler):
 *   - ignores non-LEAD jobs (MARKET_PULSE keeps its own logging),
 *   - logs structured metadata on EVERY attempt,
 *   - republishes to `lead-jobs-dlq` ONLY once attempts are exhausted, with a
 *     deterministic jobId so republication is idempotent.
 *
 * Never throws: it runs inside an event-emitter callback, and observability
 * imports are lazy to avoid a module cycle (leadQueueObservability imports
 * this module).
 */
export function attachLeadJobFailureHandler(worker: {
  on: (event: 'failed', cb: (job: any, err: any) => void) => unknown;
}): void {
  worker.on('failed', (job: any, err: any) => {
    try {
      if (!job) return;
      const data = job.data as { type?: string } | undefined;
      if (data?.type !== 'LEAD') return;

      const meta = buildLeadJobFailureMetadata({
        jobId: String(job.id ?? 'unknown'),
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        attemptsAllowed: job.opts?.attempts ?? 1,
        failedReason: err?.message ?? 'unknown',
        stack: err?.stack ?? null,
        data: job.data,
      });

      void import('./leadQueueObservability')
        .then(({ recordLeadJobFailure }) => {
          const { category } = recordLeadJobFailure({
            jobId: meta.job_id,
            reason: err?.message ?? null,
          });
          console.warn('[lead-job-failed]', JSON.stringify({ category, ...meta }));

          // Republish ONLY once BullMQ has spent every attempt — an
          // intermediate failure is still going to be retried, and
          // dead-lettering it would report a live job as dead.
          if (meta.attempts_made < meta.attempts_allowed) return;

          return getLeadDeadLetterQueue().add(
            'lead-job-failed',
            { category, ...meta },
            { jobId: `dlq:${meta.job_id}` },
          );
        })
        .catch(onLeadFailureHandlerError(meta.job_id));
    } catch (e) {
      // Synchronous throw arm — `.catch()` above cannot intercept this.
      onLeadFailureHandlerError(String(job?.id ?? 'unknown'))(e);
    }
  });
}

function onLeadFailureHandlerError(jobId: string) {
  return (e: unknown) => {
    console.error(
      '[lead-job-dlq-publish-failed]',
      JSON.stringify({ job_id: jobId, error: e instanceof Error ? e.message : String(e) }),
    );
  };
}

export type LeadJobFailureMetadata = {
  job_id: string;
  job_name: string;
  attempts_made: number;
  attempts_allowed: number;
  failed_reason: string;
  stack: string | null;
  data: unknown;
  timestamp: string;
};

export function buildLeadJobFailureMetadata(args: {
  jobId: string;
  jobName: string;
  attemptsMade: number;
  attemptsAllowed: number;
  failedReason: string;
  stack?: string | null;
  data: unknown;
}): LeadJobFailureMetadata {
  return {
    job_id: args.jobId,
    job_name: args.jobName,
    attempts_made: args.attemptsMade,
    attempts_allowed: args.attemptsAllowed,
    failed_reason: args.failedReason,
    stack: args.stack ?? null,
    data: args.data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Deterministic, retry-safe BullMQ jobId. Pass into `queue.add(name, data,
 * { jobId })` to dedupe duplicate enqueues triggered by retries.
 */
export function buildLeadJobIdempotencyKey(parts: {
  organizationId: string;
  leadJobId: string;
  mode?: string;
}): string {
  const payload = JSON.stringify({
    org: parts.organizationId,
    job: parts.leadJobId,
    mode: parts.mode ?? 'default',
  });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `lead-job:${parts.leadJobId}:${hash}`;
}

// W1-4: getLeadQueueHealth removed with the orphaned `lead-jobs` queue
// (leadQueue.ts deleted — no producer existed, no bootstrap ever registered
// its consumer, and the module-level Queue opened a Redis connection at
// import time). Live lead processing runs on `engine-jobs`; its counts come
// from getLeadQueueObservabilitySnapshot (leadQueueObservability.ts). The
// hardened defaults + idempotency/metadata helpers above remain in use.
