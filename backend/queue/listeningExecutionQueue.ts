/**
 * Phase 3 — Dedicated BullMQ queue for listening executions.
 *
 * Isolated from `engine-jobs` and `lead-jobs` so failures in the listening
 * pipeline cannot affect Market Pulse, BOLT, or the existing lead-job path.
 * Phase 3 only enqueues; the worker consumer is registered in
 * `startWorkers.ts` via the engine-jobs hook style.
 *
 * Defaults:
 *   • attempts:    3
 *   • backoff:     exponential, base 30s
 *   • removeOnComplete: 24h
 *   • removeOnFail:     14d (long retention so blocked / failed executions
 *                       remain inspectable)
 *
 * The execution payload is intentionally small — just (executionId,
 * organizationId, sourceId). All actual state lives on listening_executions.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConfig, getQueuePrefix } from './bullmqClient';

export const LISTENING_EXECUTION_QUEUE_NAME = 'listening-executions' as const;

export const listeningExecutionDefaults: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export const listeningExecutionQueue = new Queue(LISTENING_EXECUTION_QUEUE_NAME, {
  connection: getRedisConfig(),
  prefix: getQueuePrefix(),
  defaultJobOptions: listeningExecutionDefaults,
});

export type ListeningExecutionJobPayload = {
  executionId: string;
  organizationId: string;
  listeningSourceId: string;
};

export function buildListeningExecutionJobId(executionId: string): string {
  // BullMQ jobId == execution row id. The DB UNIQUE index on
  // listening_executions ensures one row per non-terminal status per source,
  // so BullMQ never sees a duplicate add.
  return `listening-exec:${executionId}`;
}
