/**
 * BOLT pipeline failure persistence.
 *
 * Single entry point for "this stage threw — record the raw failure on
 * bolt_execution_runs and bolt_execution_events". Designed to:
 *
 *   1. Preserve the original error object — caller still re-throws it.
 *   2. Capture raw message + stack + code + classification, separately
 *      from the user-friendly fallback the UI already consumes.
 *   3. Stamp pipeline mode (week_plan / daily_plan / schedule) and
 *      campaign type (bolt-text / bolt-creator / bolt-combined) so
 *      operators can filter dashboards by surface.
 *   4. NEVER throw from inside the catch path. If persistence itself
 *      blows up (RLS, network), we log to console and swallow — the
 *      caller has already preserved the original error and must
 *      re-raise it intact.
 *
 * Frontend safety: the existing `error_message` column continues to
 * carry the user-friendly text via `getUserFriendlyMessage(...)`.
 * Raw fields (`raw_error_message`, `error_stack`, `failed_stage`,
 * `failed_after_ms`, `pipeline_mode`, `campaign_type`) are diagnostic
 * only — `/api/bolt/progress` MUST NOT return them.
 *
 * Migration: `supabase/migrations/20260515_bolt_pipeline_error_instrumentation.sql`.
 */

import { ownedDbTable } from '../db/writeOwner';
import { normalizePipelineError, type NormalizedPipelineError } from '../../lib/shared/bolt/normalizePipelineError';
import { getUserFriendlyMessage } from '../utils/userFriendlyErrors';

export type BoltPipelineMode = 'week_plan' | 'daily_plan' | 'schedule' | 'campaign_schedule' | 'repurpose' | string;
export type BoltCampaignType = 'bolt-text' | 'bolt-creator' | 'bolt-combined' | string;

export interface PersistPipelineFailureInput {
  /** The run currently failing. Required — without it nothing persists. */
  runId: string;
  /** Which pipeline stage was running when the throw happened. */
  stage: string;
  /** Whatever was actually thrown — Error, AggregateError, plain string, etc. */
  error: unknown;
  /** When the pipeline (or stage) started, for `failed_after_ms` accounting. */
  runStartedAt: number;
  /** outcomeView from the payload — week_plan / daily_plan / schedule / … */
  pipelineMode?: BoltPipelineMode | null;
  /** Derived campaign surface — bolt-text / bolt-creator / bolt-combined. */
  campaignType?: BoltCampaignType | null;
  /** Optional campaign id if it has been minted by `source-recommendation`. */
  campaignId?: string | null;
  /** Per-stage start (defaults to `runStartedAt` if omitted). */
  stageStartedAt?: number;
}

export interface PersistPipelineFailureResult {
  /** The user-facing message the UI should display (existing contract). */
  userMessage: string;
  /** Full normalized error for callers that want to log/forward it. */
  normalized: NormalizedPipelineError;
}

/**
 * Persist a pipeline failure to `bolt_execution_runs` + `bolt_execution_events`
 * without ever throwing.
 *
 * Returns the user-friendly message so the caller can use it for the
 * `error_message` column (kept for UI back-compat) and for logEvent.
 */
export async function persistPipelineFailure(
  input: PersistPipelineFailureInput
): Promise<PersistPipelineFailureResult> {
  const { runId, stage, error, runStartedAt, pipelineMode, campaignType, campaignId, stageStartedAt } = input;

  const normalized = normalizePipelineError(error);
  const userMessage = await getUserFriendlyMessage(error, 'campaign').catch(() => {
    // userFriendlyErrors should never throw, but if its DB lookup blows up,
    // fall back to the normalized message rather than crashing the catch path.
    return normalized.message;
  });

  const failedAfterMs = Math.max(0, Date.now() - runStartedAt);
  const stageDurationMs = stageStartedAt ? Math.max(0, Date.now() - stageStartedAt) : null;

  // Standardized operator log line. One JSON record per failure — greppable.
  console.error('[bolt/pipeline-error]', {
    run_id: runId,
    stage,
    mode: pipelineMode ?? null,
    campaign_type: campaignType ?? null,
    campaign_id: campaignId ?? null,
    message: normalized.message,
    code: normalized.code,
    type: normalized.type,
    retriable: normalized.retriable,
    failed_after_ms: failedAfterMs,
    stage_duration_ms: stageDurationMs,
    details: normalized.details,
    stack: normalized.stack,
  });

  // Persist to bolt_execution_runs — friendly message kept for UI; raw
  // diagnostic fields populated alongside. Best-effort: any failure here
  // is logged and swallowed so the caller can still re-throw the original.
  try {
    await ownedDbTable('bolt_execution_runs')
      .update({
        status: 'failed',
        error_message: userMessage,
        raw_error_message: normalized.message,
        error_stack: normalized.stack,
        failed_stage: stage,
        failed_after_ms: failedAfterMs,
        pipeline_mode: pipelineMode ?? null,
        campaign_type: campaignType ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);
  } catch (persistErr) {
    console.error('[bolt/error-persist-failed]', {
      run_id: runId,
      stage,
      original_message: normalized.message,
      persist_error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
  }

  // Event log — keeps the per-stage timeline complete. Same best-effort policy.
  try {
    await ownedDbTable('bolt_execution_events').insert({
      run_id: runId,
      stage,
      status: 'failed',
      metadata: {
        // Friendly version kept here too so the existing event-replay UI
        // surfaces the same message it always did.
        error_message: userMessage,
        // Raw diagnostic payload — gated to ops queries, never the UI.
        raw_error_message: normalized.message,
        error_type: normalized.type,
        error_code: normalized.code,
        retriable: normalized.retriable,
        details: normalized.details,
        stage_duration_ms: stageDurationMs,
        failed_after_ms: failedAfterMs,
        campaign_id: campaignId ?? undefined,
      },
    });
  } catch (eventErr) {
    console.error('[bolt/error-persist-failed]', {
      run_id: runId,
      stage,
      kind: 'event_insert',
      persist_error: eventErr instanceof Error ? eventErr.message : String(eventErr),
    });
  }

  return { userMessage, normalized };
}

/**
 * Derive the campaign-type tag from the execution payload. Pure helper —
 * exported so the pipeline can stamp the tag once at run start.
 */
export function deriveBoltCampaignType(executionConfig: Record<string, unknown> | undefined | null): BoltCampaignType {
  const mode = String(executionConfig?.campaign_mode ?? '').toLowerCase().trim();
  if (mode === 'creator') return 'bolt-creator';
  if (mode === 'combined') return 'bolt-combined';
  return 'bolt-text';
}
