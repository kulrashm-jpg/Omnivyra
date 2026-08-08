/**
 * WS-6E Phase 4 — Automation task worker.
 *
 * CONSUMER ONLY. This module exposes the queue binding used by
 * `registerSharedConsumers` (backend/queue/workerTopology.ts). It invokes
 * `processAutomationTaskJob` and nothing else.
 *
 * THE RUNTIME REMAINS DARK. A registered consumer is not an active runtime:
 * nothing enqueues to `automation-tasks`. `buildAutomationSummary` still runs
 * synchronously at leadIntelligenceOrchestration/orchestrator.ts:378 and its
 * output is not dispatched. The producer lands in WS-6F.
 *
 * WHY THE CONSUMER ATTACHES BEFORE THE PRODUCER. This mirrors the documented
 * `planner-refinement` precedent in the manifest: the consumer attaches even
 * while the enqueue flag is off, so jobs queued during an enabled period always
 * drain. Attaching first means enabling the producer can never strand work.
 *
 * Concurrency is bounded and overridable, matching the sibling shared consumers.
 */

import type { Job } from 'bullmq';
import {
  processAutomationTaskJob,
  type AutomationTaskJobPayload,
} from '../queue/jobProcessors/automationTaskProcessor';

/** Bounded by default; matches the sibling shared consumers (2). */
export function automationTaskConcurrency(): number {
  return Math.max(1, Number(process.env.AUTOMATION_TASK_CONCURRENCY || 2));
}

/**
 * The queue handler.
 *
 * Delegates wholesale — no orchestration, no summary construction, no retry
 * logic. Errors propagate so the queue's declared attempts/backoff and the
 * platform `deadLetterOnExhaustion` path apply unchanged.
 */
export async function runAutomationTaskJob(job: Job<AutomationTaskJobPayload>): Promise<void> {
  await processAutomationTaskJob(job);
}
