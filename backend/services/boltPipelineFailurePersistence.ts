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
import { supabase } from '../db/supabaseClient';
import { normalizePipelineError, type NormalizedPipelineError } from '../../lib/shared/bolt/normalizePipelineError';
import { classifyBoltFailure, type ClassifiedBoltFailure } from '../../lib/shared/bolt/classifyBoltFailure';
import type { StrategySnapshot } from '../../lib/shared/bolt/captureStrategySnapshot';
import { getUserFriendlyMessage } from '../utils/userFriendlyErrors';
// Attribution authority lives in the lean, dependency-free module so the
// abandonment sweepers can reuse the exact same derivation. Re-exported
// here for back-compat — there is ONE derivation system (Phase 6I-3).
import type {
  BoltPipelineMode,
  BoltCampaignType,
} from '../../lib/shared/bolt/abandonmentAttribution';

export {
  deriveBoltCampaignType,
  deriveBoltPipelineMode,
  deriveAbandonmentAttribution,
} from '../../lib/shared/bolt/abandonmentAttribution';
export type { BoltPipelineMode, BoltCampaignType } from '../../lib/shared/bolt/abandonmentAttribution';

const STACK_EXCERPT_BYTES = 2_000;

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
  /** Optional strategy id when known. Best-effort — not all stages carry one. */
  strategyId?: string | null;
  /** Snapshot of strategy/execution-config at failure time, for the
   *  super-admin failure dashboard's differential view. Best-effort. */
  strategySnapshot?: StrategySnapshot | null;
  /** company_id when known. Stamped on the failure summary row so
   *  per-tenant filtering doesn't need a runs round-trip. */
  companyId?: string | null;
}

export interface PersistPipelineFailureResult {
  /** The user-facing message the UI should display (existing contract). */
  userMessage: string;
  /** Full normalized error for callers that want to log/forward it. */
  normalized: NormalizedPipelineError;
  /** Operator-facing classification used by the failure dashboard. */
  classification: ClassifiedBoltFailure;
}

function truncate(text: string | null, limit: number): string | null {
  if (text == null) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} bytes]`;
}

/**
 * Best-effort write to the bolt_failure_summary table. Never throws.
 *
 * On every failure we:
 *   1. Clear is_terminal on prior rows for this run (so the dashboard's
 *      one-row-per-run filter always reflects the LATEST catch site).
 *   2. Insert a new row with is_terminal=true.
 *
 * Step 1 is best-effort; if it fails we still insert the new row.
 * Worst case: a dashboard query without `is_terminal` filtering sees
 * multiple rows, which is the documented behaviour anyway.
 *
 * Outer-pipeline catches and per-stage catches BOTH write a row. The
 * outer catch typically fires AFTER the per-stage one, so the outer
 * row ends up flagged terminal — which is correct, because the outer
 * catch is the last word on whether the run actually died.
 */
async function persistFailureSummaryRow(args: {
  runId: string;
  stage: string;
  companyId: string | null;
  campaignId: string | null;
  strategyId: string | null;
  pipelineMode: string | null;
  campaignType: string | null;
  normalized: NormalizedPipelineError;
  classification: ClassifiedBoltFailure;
  strategySnapshot: StrategySnapshot | null;
}): Promise<void> {
  // Resolve current_stage from the run row best-effort. The catch site
  // already knows `stage`, but current_stage on the run row can race
  // ahead of the stage that actually threw — capturing both is the
  // whole point of the spec's "failed_stage vs current_stage" pair.
  let currentStage: string | null = null;
  let resolvedCompanyId = args.companyId;
  try {
    const { data: runRow } = await supabase
      .from('bolt_execution_runs')
      .select('current_stage, company_id')
      .eq('id', args.runId)
      .maybeSingle();
    if (runRow && typeof runRow === 'object') {
      currentStage = (runRow as { current_stage?: string | null }).current_stage ?? null;
      if (!resolvedCompanyId) {
        resolvedCompanyId = (runRow as { company_id?: string | null }).company_id ?? null;
      }
    }
  } catch {
    // Falls back to args; missing current_stage is fine.
  }

  try {
    await ownedDbTable('bolt_failure_summary')
      .update({ is_terminal: false })
      .eq('run_id', args.runId)
      .eq('is_terminal', true);
  } catch {
    // Non-fatal — the new row will still be inserted with is_terminal=true.
  }

  try {
    await ownedDbTable('bolt_failure_summary').insert({
      run_id: args.runId,
      campaign_id: args.campaignId,
      company_id: resolvedCompanyId,
      strategy_id: args.strategyId,
      failed_stage: args.stage,
      current_stage: currentStage,
      pipeline_mode: args.pipelineMode,
      campaign_type: args.campaignType,
      raw_error_message: args.normalized.message,
      stack_excerpt: truncate(args.normalized.stack, STACK_EXCERPT_BYTES),
      provider: args.classification.provider,
      normalized_error_type: args.classification.category,
      retriable: args.classification.retriable,
      strategy_snapshot: args.strategySnapshot ?? null,
      is_terminal: true,
    });
  } catch (insertErr) {
    console.error('[bolt/failure-summary-insert-failed]', {
      run_id: args.runId,
      stage: args.stage,
      category: args.classification.category,
      insert_error: insertErr instanceof Error ? insertErr.message : String(insertErr),
    });
  }
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
  const { runId, stage, error, runStartedAt, pipelineMode, campaignType, campaignId, stageStartedAt, strategyId, strategySnapshot, companyId } = input;

  const normalized = normalizePipelineError(error);
  const classification = classifyBoltFailure({
    normalized,
    error,
    stage,
    pipelineMode: pipelineMode ?? null,
  });
  // Pass the classified category as an extra context hint to the
  // user-friendly resolver. The resolver reads the hint when matching
  // mappings — see expanded mappings in userFriendlyErrorService.ts.
  const userMessage = await getUserFriendlyMessage(error, 'campaign', {
    boltCategory: classification.category,
  }).catch(() => {
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
    // Operator-facing classification + provider attribution. Read by
    // the failure dashboard; logged here so it's also visible in
    // log streams without joining back to bolt_failure_summary.
    category: classification.category,
    provider: classification.provider,
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

  // Additive: write a row to bolt_failure_summary for the operator
  // dashboard. Never throws — own try/catch internally. Existing
  // bolt_execution_runs + bolt_execution_events writes above are
  // unchanged so the UI contract is preserved.
  await persistFailureSummaryRow({
    runId,
    stage,
    companyId: companyId ?? null,
    campaignId: campaignId ?? null,
    strategyId: strategyId ?? null,
    pipelineMode: pipelineMode ?? null,
    campaignType: campaignType ?? null,
    normalized,
    classification,
    strategySnapshot: strategySnapshot ?? null,
  });

  return { userMessage, normalized, classification };
}
