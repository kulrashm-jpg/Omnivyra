/**
 * Async refinement job processor.
 *
 * Triggered by jobs enqueued via `enqueueAsyncRefinement`. Looks up the
 * persisted base plan, runs `postProcessGeneratedPlan` to apply language
 * refinement / strategy mapping / momentum recovery, persists the refined
 * plan, and emits `refinement_completed` on the planner event bus.
 *
 * Idempotency:
 *   - Job id collisions are rejected by BullMQ at enqueue time.
 *   - Inside the processor, a stale-revision check skips work when a newer
 *     plan revision has already been committed to the DB.
 *   - The persistence step is atomic per `plan_revision_id`.
 *
 * Failure semantics:
 *   - The base campaign is already saved. Any failure here leaves the base
 *     intact — only the refinement is missing. The UI shows the base plan.
 *   - Single attempt — no retries — to avoid duplicate refinements competing.
 */

import type { Job } from 'bullmq';
import { logger } from '../../services/logger';
import { plannerEventBus } from '../../services/plannerEventBus';
import { recordPlannerAlertCounter } from '../../services/plannerAlerting';
import type { AsyncRefinementJobPayload } from '../../services/campaignAiOrchestrator/asyncRefinement';

export async function processAsyncRefinementJob(
  job: Job<AsyncRefinementJobPayload>,
): Promise<{ refined: boolean; reason?: string }> {
  // BullMQ consumer span: restore any traceparent stamped on the job
  // payload at enqueue time so the trace stays connected from the
  // synchronous orchestrator → async refinement worker. Falls through
  // gracefully when the tracing module isn't installed.
  let withSpan: (typeof import('../../services/plannerTracing'))['withSpan'] | null = null;
  let runInContext: (typeof import('../../services/plannerTracing'))['runInContext'] | null = null;
  let restoreContextFromEnvelope: (typeof import('../../services/plannerTracing'))['restoreContextFromEnvelope'] | null = null;
  try {
    const m = require('../../services/plannerTracing') as typeof import('../../services/plannerTracing');
    withSpan = m.withSpan;
    runInContext = m.runInContext;
    restoreContextFromEnvelope = m.restoreContextFromEnvelope;
  } catch { /* tracing-safe */ }

  const restored = restoreContextFromEnvelope?.(job.data as unknown as Record<string, unknown>) ?? null;
  const work = () => processAsyncRefinementJobInner(job);
  if (!withSpan) return work();
  const wrapped = () => withSpan!(`refinement/process`, async (span) => {
    span.setAttribute('bullmq.job_id', job.id ?? '');
    span.setAttribute('bullmq.queue', 'planner-refinement');
    span.setAttribute('campaign_id', job.data.campaignId);
    span.setAttribute('plan_revision_id', job.data.planRevisionId);
    return await work();
  }, { kind: 'consumer' });
  return restored && runInContext ? runInContext(restored, wrapped) : wrapped();
}

async function processAsyncRefinementJobInner(
  job: Job<AsyncRefinementJobPayload>,
): Promise<{ refined: boolean; reason?: string }> {
  const startedAt = Date.now();
  const { campaignId, planRevisionId, snapshotHash } = job.data;
  logger.info('async_refinement_started', {
    job_id: job.id,
    campaign_id: campaignId,
    plan_revision_id: planRevisionId,
  });

  try {
    // Stale-revision detection is delegated to the optimistic-concurrency
    // check inside saveStructuredCampaignPlanRefinement: if another writer
    // bumped `refinement_version` between our read and write, the update
    // affects 0 rows and we return `stale_revision`. That is stricter than
    // a snapshot_hash comparison and covers in-flight inline refinements
    // landing during our LLM call. snapshotHash is still kept on the
    // payload for forensic logging only.
    void snapshotHash;

    // The actual refinement implementation is left as a thin wrapper on
    // `postProcessGeneratedPlan` so the existing well-tested code path is
    // reused. The processor passes through pool: 'refinement' so the
    // distributed semaphore + token bucket govern this call separately
    // from the synchronous planner.
    const { postProcessGeneratedPlan } =
      await import('../../services/campaignAiOrchestrator/postProcessGeneratedPlan');
    const { getCampaignPlanByVersionId, saveStructuredCampaignPlanRefinement } =
      await import('../../db/campaignPlanStore');

    // Read base plan + observed refinement_version for optimistic concurrency.
    const baseRow = await getCampaignPlanByVersionId(planRevisionId);
    if (!baseRow) {
      logger.warn('async_refinement_skipped_no_base_plan', {
        job_id: job.id,
        campaign_id: campaignId,
        plan_revision_id: planRevisionId,
      });
      return { refined: false, reason: 'no_base_plan' };
    }
    const expectedVersion = baseRow.refinement_version;

    const refined = await postProcessGeneratedPlan({
      structured: { weeks: baseRow.weeks, campaign_id: campaignId } as any,
      campaignId,
      snapshotHash: snapshotHash ?? '',
      omnivyreDecision: { decision: 'refine_only', raw: {} } as any,
      rawPlanText: job.data.rawPlanText,
      distributionStrategy: job.data.distributionStrategy as any,
      distributionReason: job.data.distributionReason as any,
      validationResult: undefined,
      effectivePrefilledPlanning: null,
      prefilledPlanning: null,
      strategyMemory: null,
      companyId: job.data.companyId,
    });

    // Persist with optimistic concurrency: only commit if refinement_version
    // is still what we observed. A concurrent inline refinement or a newer
    // async job that beat us will bump the version first → applied=false.
    const result = await saveStructuredCampaignPlanRefinement({
      campaignId,
      planRevisionId,
      refined,
      expectedVersion,
      source: 'async',
    });
    if (!result.applied) {
      logger.info('async_refinement_skipped_optimistic_concurrency', {
        job_id: job.id,
        campaign_id: campaignId,
        plan_revision_id: planRevisionId,
        observed_version: expectedVersion,
        reason: result.reason,
      });
      return { refined: false, reason: result.reason ?? 'stale_revision' };
    }

    logger.info('async_refinement_completed', {
      job_id: job.id,
      campaign_id: campaignId,
      plan_revision_id: planRevisionId,
      duration_ms: Date.now() - startedAt,
      new_version: result.newVersion,
    });

    plannerEventBus.emit({
      type: 'refinement_completed',
      campaign_id: campaignId,
      plan_revision_id: planRevisionId,
      payload: {
        duration_ms: Date.now() - startedAt,
        new_version: result.newVersion,
        source: 'async',
      },
    });
    return { refined: true };
  } catch (err) {
    logger.warn('async_refinement_failed', {
      job_id: job.id,
      campaign_id: campaignId,
      plan_revision_id: planRevisionId,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    });
    // Dedicated refinement_failure counter (Part 7 distributed metrics).
    recordPlannerAlertCounter('refinement_failure', { reason: err instanceof Error ? err.message : 'unknown' });
    return { refined: false, reason: 'error' };
  }
}
