/**
 * WS-6C Phase 2 — Dedicated BullMQ queue for Automation task dispatch.
 *
 * INFRASTRUCTURE ONLY. This module declares the queue and its job policy.
 * It has NO producer and NO consumer: nothing enqueues, nothing drains, and
 * Automation execution remains impossible until WS-6D wires the processor and
 * worker, and a later phase adds the orchestrator enqueue.
 *
 * The queue is registered in `workerTopologyManifest.ts` as
 * `consumedVia: 'none' / status: 'DORMANT'`, and `workerTopologyParity` enforces
 * that its name appears in NEITHER bootstrap nor the shared registrar. Adding a
 * consumer therefore REQUIRES updating the manifest in the same change.
 *
 * Automation summaries are built once, synchronously, by
 * `buildAutomationSummary` in leadIntelligenceOrchestration/orchestrator.ts.
 * When the enqueue path lands, jobs must carry that ALREADY-BUILT summary — the
 * consumer must never rebuild it, or the summary would be computed twice.
 *
 * Concurrency, attempts and backoff are bounded, mirroring the existing
 * semanticIndexingQueue policy. No autonomous job generation.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConfig, getQueuePrefix } from './bullmqClient';

export const AUTOMATION_TASK_QUEUE_NAME = 'automation-tasks' as const;

export const automationTaskDefaults: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export const automationTaskQueue = new Queue(AUTOMATION_TASK_QUEUE_NAME, {
  connection: getRedisConfig(),
  prefix: getQueuePrefix(),
  defaultJobOptions: automationTaskDefaults,
});
