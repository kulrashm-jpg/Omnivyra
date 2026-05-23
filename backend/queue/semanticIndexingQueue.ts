/**
 * Phase 9 — Dedicated BullMQ queue for semantic indexing PARTITIONS.
 *
 * Async runtime activation: a `semantic_indexing_jobs` row is split into
 * bounded partitions (`semantic_indexing_partitions`), and each partition
 * is enqueued here. Deterministic per-partition jobId keeps re-enqueue
 * idempotent. No long-lived worker state; per-partition checkpoints live
 * in the row.
 *
 * Concurrency, attempts, and backoff are bounded. NO autonomous
 * generation of jobs — partitions are only created by explicit operator
 * action via the existing semantic-indexing API.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConfig, getQueuePrefix } from './bullmqClient';
import { SEMANTIC_PARTITION_QUEUE_NAME } from '../types/semanticIndexingPartition';

export { SEMANTIC_PARTITION_QUEUE_NAME };

export const semanticIndexingDefaults: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export const semanticIndexingQueue = new Queue(SEMANTIC_PARTITION_QUEUE_NAME, {
  connection: getRedisConfig(),
  prefix: getQueuePrefix(),
  defaultJobOptions: semanticIndexingDefaults,
});

export type SemanticPartitionJobPayload = {
  partitionId: string;
  organizationId: string;
  semanticIndexingJobId: string;
};

export function buildSemanticPartitionJobId(partitionId: string): string {
  return `semantic-partition:${partitionId}`;
}
