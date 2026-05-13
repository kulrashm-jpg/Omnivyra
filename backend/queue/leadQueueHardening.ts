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
 * To activate end-to-end (deferred until ops opt-in):
 *   1. Replace the `defaultJobOptions` block in leadQueue.ts with
 *      `import { leadQueueHardenedDefaults } from './leadQueueHardening'`
 *      and use `defaultJobOptions: leadQueueHardenedDefaults`.
 *   2. In the lead-job worker's `failed` handler, call
 *      `buildLeadJobFailureMetadata(...)` and either log or republish to
 *      `leadDeadLetterQueue` once attempts are exhausted.
 *   3. Enqueue callers pass `jobId: buildLeadJobIdempotencyKey(...)` to
 *      guarantee dedup across retries.
 *
 * Phase 0 ships the foundation only — no worker change, no DLQ producer.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { createHash } from 'crypto';
import { leadQueueConnection } from './leadQueue';

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

export const leadDeadLetterQueue = new Queue(LEAD_DLQ_NAME, {
  connection: leadQueueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 30 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

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

import { leadQueue } from './leadQueue';

export async function getLeadQueueHealth(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  attempts_allowed_default: number;
  backoff_delay_ms_default: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    leadQueue.getWaitingCount(),
    leadQueue.getActiveCount(),
    leadQueue.getCompletedCount(),
    leadQueue.getFailedCount(),
    leadQueue.getDelayedCount(),
  ]);
  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    attempts_allowed_default: LEAD_QUEUE_ATTEMPTS,
    backoff_delay_ms_default: LEAD_QUEUE_BACKOFF_DELAY_MS,
  };
}
