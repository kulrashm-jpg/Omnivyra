/**
 * Phase 9 — Dedicated BullMQ queue for distributed REPLAY PARTITIONS.
 *
 * Each `replay_operations` row may be split into partitions for parallel
 * processing. Per-partition jobId is deterministic so re-enqueue is
 * idempotent. NO autonomous replay generation — partitions only exist
 * because an operator explicitly approved the parent replay.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConfig } from './bullmqClient';
import { REPLAY_PARTITION_QUEUE_NAME } from '../types/replayPartition';

export { REPLAY_PARTITION_QUEUE_NAME };

export const replayPartitionDefaults: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export const replayPartitionQueue = new Queue(REPLAY_PARTITION_QUEUE_NAME, {
  connection: getRedisConfig(),
  defaultJobOptions: replayPartitionDefaults,
});

export type ReplayPartitionJobPayload = {
  partitionId: string;
  organizationId: string;
  replayOperationId: string;
};

export function buildReplayPartitionJobId(partitionId: string): string {
  return `replay-partition:${partitionId}`;
}
