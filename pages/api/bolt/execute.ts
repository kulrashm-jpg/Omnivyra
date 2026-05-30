
/**
 * POST /api/bolt/execute
 *
 * Starts a BOLT execution run in the background.
 * Returns run_id immediately so the UI can poll for progress.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getBoltQueue } from '../../../backend/queue/boltQueue';
import { getUserFriendlyMessage } from '../../../backend/utils/userFriendlyErrors';
import { executeBoltPipeline } from '../../../backend/services/boltPipelineService';
import { config } from '@/config';

/**
 * Inline sweep of abandoned-but-still-locked runs for the company
 * that's launching a new one. Runs BEFORE dispatch so HMR-orphaned /
 * dead-worker runs that left their lock held don't accumulate and
 * don't confuse the user with "stuck on Preparing week plan" cards
 * from previous attempts.
 *
 * "Abandoned" = status='started' OR status='running', heartbeat older
 * than 90 seconds, AND lock has expired. Anything actively progressing
 * gets a heartbeat write multiple times per stage (see boltPipelineService
 * → updateRun → heartbeat_at + lock_expires_at refresh) so a live run
 * never matches this filter.
 *
 * Best-effort; failures are logged but never block the new run.
 */
async function recoverAbandonedCompanyRuns(companyId: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - 90 * 1000).toISOString();
    // Forensic-integrity sweep. The sweeper NEVER touches
    // error_message / raw_error_message / failed_stage — those are
    // the exclusive domain of persistPipelineFailure(). The sweeper
    // only records abandonment metadata in dedicated columns so the
    // two flavours of failure (real stage-thrown cause + sweeper-
    // detected abandonment) can coexist on the same row without
    // either erasing the other.
    //
    // Behavior matrix after this sweep:
    //   * Row had a real error from persistPipelineFailure:
    //     error_message intact, raw_error_message intact, plus
    //     abandonment_reason populated → operator sees BOTH causes.
    //   * Row was truly abandoned (process died before any throw):
    //     error_message NULL, raw_error_message NULL,
    //     abandonment_reason populated → operator immediately knows
    //     this was a worker/HMR/lifecycle death, not a stage error.
    const { data, error } = await ownedDbTable('bolt_execution_runs')
      .update({
        status: 'failed',
        abandonment_reason: 'sweeper_heartbeat_stale_inline',
        abandonment_detected_at: nowIso,
        lock_owner: null,
        lock_expires_at: null,
        updated_at: nowIso,
      })
      .eq('company_id', companyId)
      .in('status', ['started', 'running'])
      .lt('heartbeat_at', cutoffIso)
      .or(`lock_expires_at.is.null,lock_expires_at.lt.${nowIso}`)
      .is('abandonment_detected_at', null)
      .select('id, error_message');
    if (error) {
      console.warn('[bolt/execute] inline sweep failed (non-fatal):', error.message);
      return;
    }
    if (Array.isArray(data) && data.length > 0) {
      // Structured event under the canonical telemetry envelope.
      // Splits "swept rows that ALSO had a real error" (a worker died
      // after persisting its cause) from "swept rows that had no
      // diagnostic" (pure abandonment) for forensic correlation.
      const withDiagnostic = data.filter((r) => (r as { error_message: string | null }).error_message != null).length;
      // Causal-chain linkage. When the sweep included rows that
      // already had a persisted diagnostic, the abandonment is the
      // *trailing* event for an underlying failure that was logged
      // separately (typically as `planner_contract_violation` for
      // capacity issues or as `bolt_pipeline_error` for stage
      // throws). We emit the originating event name as a hint so
      // operators don't have to manually correlate.
      //
      // We do NOT chase the link further — that would create
      // recursive causal chains. One hop is enough to point an
      // operator at the prior event; the prior event itself is
      // self-contained.
      const originatingFailureEvent = withDiagnostic > 0 ? 'bolt_pipeline_error' : null;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitStructuredEvent } = require('../../../observability/runtime/structuredTelemetry') as typeof import('../../../observability/runtime/structuredTelemetry');
      emitStructuredEvent(
        'bolt_sweeper_recovered_abandoned',
        'info',
        { run_id: null, planner_stage: 'abandonment_sweep' },
        {
          company_id: companyId,
          recovered_ids: data.map((r) => (r as { id: string }).id),
          count_swept: data.length,
          count_with_existing_diagnostic: withDiagnostic,
          count_truly_abandoned: data.length - withDiagnostic,
          originating_failure_event: originatingFailureEvent,
          cutoff_at: cutoffIso,
        },
      );
    }
  } catch (err) {
    console.warn('[bolt/execute] inline sweep crashed (non-fatal):', (err as Error)?.message);
  }
}
import {
  getCreatorFormatsFromExecutionConfig,
  getUnsupportedCreatorFormats,
  validateCreatorScheduleRequest,
} from '../../../lib/shared/creatorGovernanceRegistry';
import { validateBoltPreExecution } from '../../../backend/services/boltPreExecutionValidator';
import { BOLT_ERROR_CODE_FRIENDLY_MESSAGES } from '../../../lib/shared/bolt/boltErrorCodes';
import { computeSiblingDifferential } from '../../../backend/services/boltStrategyDifferential';
import { resolveCampaignMode } from '../../../lib/shared/bolt/formatGovernance';

function normalizeOptionalUuid(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : null;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
    });
    if (!access) return;

    // Inline sweep BEFORE dispatch. Recovers HMR-orphaned / crashed-worker
    // runs that left status='started'+lock-held so the user doesn't see
    // "stuck on Preparing week plan" cards from the previous attempt.
    // ~5–10 ms; harmless when there's nothing to recover.
    await recoverAbandonedCompanyRuns(companyId);

    const resolvedBoltBlogType =
      body.source_blog_type === 'company' ? 'company'
      : body.source_blog_type === 'omnivyra' ? 'public'
      : null;

    const payload = {
      companyId,
      userId: normalizeOptionalUuid(access.userId),
      generatedCampaignId: body.generatedCampaignId ?? null,
      sourceStrategicTheme: body.sourceStrategicTheme ?? {},
      executionConfig: body.executionConfig ?? {},
      outcomeView: body.outcomeView ?? null,
      recId: body.recId ?? null,
      title: body.title ?? null,
      description: body.description ?? null,
      sourceOpportunityId: body.sourceOpportunityId ?? null,
      regionsFromCard: Array.isArray(body.regionsFromCard) ? body.regionsFromCard : [],
      source_blog_id: typeof body.source_blog_id === 'string' ? body.source_blog_id : null,
      source_blog_type: resolvedBoltBlogType,
    };

    // ── Blog source integrity validation ────────────────────────────────────
    if (payload.source_blog_id && payload.source_blog_type) {
      const blogTable = payload.source_blog_type === 'company' ? 'blogs' : 'public_blogs';
      const { data: blogRow, error: blogErr } = await supabase
        .from(blogTable)
        .select('id, company_id')
        .eq('id', payload.source_blog_id)
        .maybeSingle();
      if (blogErr || !blogRow) {
        return res.status(400).json({ error: 'Invalid source_blog_id: blog not found.' });
      }
      if (payload.source_blog_type === 'company' && (blogRow as any).company_id !== companyId) {
        return res.status(403).json({ error: 'Cross-company blog access denied.' });
      }
    }

    if (!payload.sourceStrategicTheme || typeof payload.sourceStrategicTheme !== 'object') {
      return res.status(400).json({ error: 'sourceStrategicTheme is required and must be an object' });
    }
    if (!payload.executionConfig || typeof payload.executionConfig !== 'object') {
      return res.status(400).json({ error: 'executionConfig is required and must be an object' });
    }

    const executionConfig = payload.executionConfig as Record<string, unknown>;
    if (String(executionConfig.campaign_mode || '').toLowerCase() === 'creator') {
      const formats = getCreatorFormatsFromExecutionConfig(executionConfig);
      const unsupportedFormats = getUnsupportedCreatorFormats(formats);
      if (unsupportedFormats.length > 0) {
        return res.status(400).json({
          error: `Unsupported creator format: ${unsupportedFormats.join(', ')}`,
          code: 'UNSUPPORTED_CREATOR_FORMAT',
          unsupported_formats: unsupportedFormats,
        });
      }
      const scheduleValidation = validateCreatorScheduleRequest({
        campaignMode: executionConfig.campaign_mode,
        outcomeView: payload.outcomeView,
        executionConfig,
      });
      if (scheduleValidation.ok === false) {
        return res.status(409).json({
          error: scheduleValidation.message,
          code: 'CREATOR_SCHEDULE_BLOCKED_BY_GOVERNANCE',
          blocked_formats: scheduleValidation.blockedFormats,
          unsupported_formats: scheduleValidation.unsupportedFormats,
        });
      }
    }

    // ── PART 1 — Comprehensive pre-execution validation ──────────────
    // Catches everything the legacy inline checks above do NOT cover:
    // text formats, strategic-theme structure, frequency/duration/goal/
    // audience presence, platform-array integrity, AND a campaign-version
    // preflight lookup. Returns the first error code so the UI shows
    // a precise message instead of "technical glitch" once the worker
    // has already burned a row in bolt_execution_runs.
    const preflight = await validateBoltPreExecution({
      companyId,
      generatedCampaignId: payload.generatedCampaignId,
      sourceStrategicTheme: payload.sourceStrategicTheme,
      executionConfig: payload.executionConfig as Record<string, unknown>,
      outcomeView: payload.outcomeView,
      selectedPlatforms: (payload.executionConfig as Record<string, unknown> | null)?.selected_platforms,
      checkCampaignVersion: true,
    });
    if (!preflight.ok) {
      const first = preflight.errors[0];
      // 409 only for hard "this strategy can never be executed" classes;
      // 400 for everything else (validation / missing inputs).
      const status = first.code === 'CAMPAIGN_VERSION_ACCESS_DENIED' ? 403
        : first.code === 'CAMPAIGN_VERSION_NOT_FOUND' || first.code === 'CAMPAIGN_VERSION_MISMATCH' ? 409
        : 400;
      return res.status(status).json({
        error: first.message,
        code: first.code,
        friendly_message: BOLT_ERROR_CODE_FRIENDLY_MESSAGES[first.code],
        all_errors: preflight.errors.map((e) => ({ code: e.code, message: e.message, field: e.field })),
      });
    }

    const generatedCampaignId = payload.generatedCampaignId;
    if (generatedCampaignId && typeof generatedCampaignId === 'string' && generatedCampaignId.trim()) {
      const { data: existingRun } = await supabase
        .from('bolt_execution_runs')
        .select('id')
        .or(`campaign_id.eq.${generatedCampaignId},target_campaign_id.eq.${generatedCampaignId}`)
        .in('status', ['running', 'started'])
        .limit(1)
        .maybeSingle();

      if (existingRun && (existingRun as { id?: string }).id) {
        return res.status(202).json({
          run_id: (existingRun as { id: string }).id,
          status: 'started',
        });
      }
    }

    // Part 7 — sibling strategy differential. Computed at enqueue time
    // and stamped into the payload so the pipeline's strategySnapshot
    // capture picks it up; the failure summary row then carries
    // `differs_from_succeeded_sibling` for the operator to see.
    const execConfig = payload.executionConfig as Record<string, unknown> | null;
    const themeForDiff = payload.sourceStrategicTheme as Record<string, unknown> | null;
    const differential = await computeSiblingDifferential({
      companyId,
      recommendationId: typeof payload.recId === 'string' ? payload.recId : null,
      opportunityId: typeof payload.sourceOpportunityId === 'string' ? payload.sourceOpportunityId : null,
      generatedCampaignId: typeof payload.generatedCampaignId === 'string' ? payload.generatedCampaignId : null,
      campaignMode: resolveCampaignMode(execConfig),
      contentFormats: Array.isArray(execConfig?.content_formats) ? (execConfig?.content_formats as unknown[]).map(String) : [],
      selectedPlatforms: Array.isArray(execConfig?.selected_platforms) ? (execConfig?.selected_platforms as unknown[]).map(String) : [],
      themeTitle: themeForDiff
        ? (typeof themeForDiff.title === 'string'
            ? themeForDiff.title
            : typeof themeForDiff.polished_title === 'string' ? themeForDiff.polished_title : null)
        : null,
    });
    const payloadWithDiff = differential
      ? { ...payload, sibling_differential: differential }
      : payload;

    const { data: run, error } = await supabase
      .from('bolt_execution_runs')
      .insert({
        company_id: companyId,
        target_campaign_id: generatedCampaignId && typeof generatedCampaignId === 'string' && generatedCampaignId.trim() ? generatedCampaignId.trim() : null,
        user_id: normalizeOptionalUuid(access.userId),
        current_stage: 'source-recommendation',
        status: 'started',
        progress_percentage: 0,
        payload: payloadWithDiff,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[bolt/execute] Insert failed:', error);
      return res.status(500).json({ error: 'Failed to create BOLT run' });
    }

    const runId = (run as { id: string }).id;

    const workersEnabled = config.ENABLE_AUTO_WORKERS;

    let queuedViaBullMQ = false;
    if (workersEnabled) {
      try {
        const queue = getBoltQueue();
        await queue.add('bolt-execution', { run_id: runId }, { jobId: runId });
        queuedViaBullMQ = true;
      } catch (queueErr) {
        console.warn('[bolt/execute] BullMQ enqueue failed, falling back to direct execution:', (queueErr as Error)?.message);
      }
    }

    // Direct in-process execution is the FALLBACK only — used when
    // BullMQ enqueue failed (Redis down, workers disabled).
    //
    // We do NOT fire direct execution when the queue accepted the job.
    // Previously this code ran direct unconditionally on the theory that
    // "the lock guarantees only one will win" — but the direct call
    // executes in the Next.js HTTP-handler process, wins the lock race
    // almost every time, then gets KILLED when Next.js cleans up after
    // the response is sent. Result: lock held by a dead promise, BullMQ
    // worker locked out for the full TTL, run stuck on stage 1.
    //
    // When workers ARE running, trust them. When workers aren't running
    // (BullMQ enqueue throws), fall back to direct execution. The
    // sweeper handles the "BullMQ accepted but no worker is alive" edge
    // case by reclaiming the run after the heartbeat threshold.
    if (!queuedViaBullMQ) {
      // Synchronous state transition so the UI doesn't see the default
      // `status='started'` if the void promise gets dropped by the
      // dev-server runtime before the pipeline's first write.
      try {
        const nowIso = new Date().toISOString();
        await supabase
          .from('bolt_execution_runs')
          .update({ status: 'running', heartbeat_at: nowIso, updated_at: nowIso })
          .eq('id', runId);
      } catch (preErr) {
        console.warn('[bolt/execute] pre-dispatch status write failed (non-fatal):', (preErr as Error)?.message);
      }

      console.log(`[bolt/execute] Running pipeline directly for run ${runId} (workers unavailable)`);
      void executeBoltPipeline(runId).catch(async (err) => {
        console.error('[bolt/execute] Direct pipeline failed:', err?.message);
      });
    } else {
      console.log(`[bolt/execute] Queued via BullMQ for run ${runId}`);
    }

    return res.status(202).json({
      run_id: runId,
      status: 'started',
    });
  } catch (err) {
    console.error('[bolt/execute]', err);
    const userMsg = await getUserFriendlyMessage(err, 'campaign');
    return res.status(500).json({ error: userMsg });
  }
}
