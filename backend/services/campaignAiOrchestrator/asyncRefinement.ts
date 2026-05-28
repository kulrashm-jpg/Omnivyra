/**
 * Async refinement orchestration.
 *
 * Moves `postProcessGeneratedPlan` (language refinement + strategy mapping +
 * momentum recovery) off the synchronous planner request path. Behavior is
 * env-gated:
 *
 *   ASYNC_REFINEMENT_ENABLED=false (default)
 *     Refinement runs inline as before. No behavior change.
 *
 *   ASYNC_REFINEMENT_ENABLED=true
 *     The synchronous planner returns the base alignment-recovered plan
 *     immediately. A BullMQ job is enqueued to apply refinement in the
 *     background. The campaign object becomes progressively richer as the
 *     refinement job persists its result back to the DB.
 *
 * Idempotency:
 *   - Job id = `refine::<campaign_id>::<plan_revision_id>`
 *   - BullMQ's `jobId` collision suppression dedups duplicate enqueues.
 *   - The processor also checks the campaign's `refinement_state` row to
 *     short-circuit if a newer revision has already been refined.
 *
 * Failure safety:
 *   - A failed refinement does NOT affect the base campaign. The base plan
 *     is already persisted before this job runs.
 *   - Retries are capped at 1 (a transient provider error should not trigger
 *     a refinement storm).
 *
 * This module is a thin enqueue helper. The actual job processor lives at
 * `backend/queue/jobProcessors/asyncRefinementProcessor.ts`.
 */

import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { plannerEventBus } from '../plannerEventBus';

export interface AsyncRefinementJobPayload {
  campaignId: string;
  planRevisionId: string;
  /**
   * Snapshot hash at the time the base plan was committed. The job
   * processor uses this to detect if a newer revision exists and aborts.
   */
  snapshotHash: string | null;
  /** Companion context that the refinement step needs. */
  companyId: string | null;
  rawPlanText: string;
  distributionStrategy: string | null;
  distributionReason: string | null;
  /** Trimmed prefilled-planning context (large JSON elided). */
  prefilledPlanningKey: string | null;
}

export function isAsyncRefinementEnabled(): boolean {
  return String(process.env.ASYNC_REFINEMENT_ENABLED ?? 'false').toLowerCase() === 'true';
}

/**
 * Enqueue a refinement job. Returns the job id (which is also the idempotency
 * key) for traceability. Never throws — refinement is best-effort.
 *
 * Idempotency contract: callers MUST pass the same `planRevisionId` for the
 * same logical revision. Re-enqueuing with the same id is a no-op (BullMQ
 * rejects duplicate jobIds).
 */
export async function enqueueAsyncRefinement(
  payload: AsyncRefinementJobPayload,
): Promise<{ enqueued: boolean; jobId: string }> {
  const jobId = `refine::${payload.campaignId}::${payload.planRevisionId}`;
  try {
    // Lazy require to avoid pulling BullMQ into test environments that
    // don't have a Redis. If anything fails, log and return enqueued=false
    // so the orchestrator can decide whether to fall back to inline refinement.
    const { getRefinementQueue } = require('../../queue/refinementQueue') as typeof import('../../queue/refinementQueue');
    const queue = getRefinementQueue();
    // Stamp the current trace context onto the job payload so the
    // consumer-side `processAsyncRefinementJob` can resume the trace.
    // `propagateContextToEnvelope` is a no-op when no active span exists.
    let propagated: Record<string, unknown> = payload as unknown as Record<string, unknown>;
    try {
      const { propagateContextToEnvelope } = require('../plannerTracing') as typeof import('../plannerTracing');
      propagated = propagateContextToEnvelope(payload as unknown as Record<string, unknown>);
    } catch { /* tracing-safe */ }
    await queue.add('refinement', propagated as never, {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 86400, count: 500 },
      removeOnFail: { age: 604800 },
    });
    logger.info('async_refinement_enqueued', {
      request_id: getRequestContext().requestId,
      campaign_id: payload.campaignId,
      plan_revision_id: payload.planRevisionId,
      job_id: jobId,
    });
    plannerEventBus.emit({
      type: 'progressive_phase_completed',
      campaign_id: payload.campaignId,
      plan_revision_id: payload.planRevisionId,
      payload: { phase: 'refinement_enqueued', job_id: jobId },
    });
    return { enqueued: true, jobId };
  } catch (err) {
    logger.warn('async_refinement_enqueue_failed', {
      request_id: getRequestContext().requestId,
      campaign_id: payload.campaignId,
      plan_revision_id: payload.planRevisionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { enqueued: false, jobId };
  }
}
