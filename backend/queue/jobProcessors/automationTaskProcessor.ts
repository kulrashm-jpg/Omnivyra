/**
 * WS-6D Phase 3 — Automation task processor.
 *
 * EXECUTION ONLY. This processor consumes an AutomationSummary that was ALREADY
 * BUILT synchronously by `buildAutomationSummary` in
 * leadIntelligenceOrchestration/orchestrator.ts:378. It must NEVER call
 * `buildAutomationSummary` — doing so would compute the summary twice and make
 * the async path diverge from the synchronous one that currently feeds WS-3.
 *
 * That invariant is enforced two ways: this module does not import
 * `automationExecution` at all (so the builder is not reachable), and the unit
 * suite asserts the absence of that import.
 *
 * UNREACHABLE BY DESIGN. Nothing registers this processor. The queue is
 * DORMANT / consumedVia:'none' in workerTopologyManifest, and
 * workerTopologyParity enforces that 'automation-tasks' appears in neither
 * bootstrap nor the shared registrar. Worker registration is WS-6E.
 *
 * RETRY / DLQ. No custom retry framework: attempts and exponential backoff are
 * declared once on the queue (`automationTaskDefaults`), and exhaustion routes
 * through the platform's existing `deadLetterOnExhaustion`. This processor
 * therefore signals failure by THROWING — swallowing an error would strand the
 * job as a false success and bypass both retry and the DLQ.
 */

import type { Job } from 'bullmq';
import { logger } from '../../services/logger';
import type { AutomationSummary } from '../../services/automationExecution/types';

/**
 * The job payload carries the already-built summary verbatim.
 *
 * `correlationId` is carried for log correlation only — never used to rebuild,
 * re-key, or re-derive the summary.
 */
export interface AutomationTaskJobPayload {
  companyId: string;
  summary: AutomationSummary;
  correlationId?: string | null;
}

/** Thrown when a job arrives without a usable pre-built summary. */
export class AutomationPayloadError extends Error {
  constructor(detail: string) {
    super(`automation task payload invalid: ${detail}`);
    this.name = 'AutomationPayloadError';
  }
}

/**
 * Validate the payload contract.
 *
 * A missing or malformed summary is NOT recoverable by retrying, but it is still
 * thrown rather than silently skipped: a swallowed payload error would look like
 * a successful execution and hide a producer defect.
 */
export function assertAutomationPayload(
  payload: AutomationTaskJobPayload | undefined | null,
): asserts payload is AutomationTaskJobPayload {
  if (!payload || typeof payload !== 'object') {
    throw new AutomationPayloadError('payload is missing');
  }
  if (typeof payload.companyId !== 'string' || payload.companyId.trim() === '') {
    throw new AutomationPayloadError('companyId is required');
  }
  const summary = payload.summary;
  if (!summary || typeof summary !== 'object') {
    throw new AutomationPayloadError('summary is required — the processor never builds one');
  }
  if (!Array.isArray(summary.tasks)) {
    throw new AutomationPayloadError('summary.tasks must be an array');
  }
  if (typeof summary.generatedAt !== 'string' || summary.generatedAt === '') {
    throw new AutomationPayloadError('summary.generatedAt is required');
  }
}

export interface AutomationProcessResult {
  companyId: string;
  taskCount: number;
  status: AutomationSummary['status'];
  generatedAt: string;
}

/**
 * Process one automation job.
 *
 * Deliberately NOT dispatching tasks yet: WS-6D owns the processor layer only.
 * The execution seam (materialisation through leadOutreachExecution, which
 * already consumes AutomationSummary synchronously) lands with worker
 * registration in WS-6E. Until then this validates the contract and records
 * what WOULD execute, so the payload shape is proven before anything runs.
 */
export async function processAutomationTaskJob(
  job: Job<AutomationTaskJobPayload>,
): Promise<AutomationProcessResult> {
  assertAutomationPayload(job?.data);
  const { companyId, summary, correlationId } = job.data;

  logger.info('automation_task_job_received', {
    jobId: job.id ?? null,
    companyId,
    correlationId: correlationId ?? null,
    taskCount: summary.tasks.length,
    status: summary.status,
    generatedAt: summary.generatedAt,
  });

  return {
    companyId,
    taskCount: summary.tasks.length,
    status: summary.status,
    generatedAt: summary.generatedAt,
  };
}
