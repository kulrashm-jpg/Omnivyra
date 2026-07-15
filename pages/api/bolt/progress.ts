import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/bolt/progress?run_id=<id>
 *
 * Returns current stage, status, and progress for a BOLT run.
 * Used by UI to poll for real-time execution progress.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { plannerEventBus } from '../../../backend/services/plannerEventBus';
import { resolveCanonicalState, CanonicalContentState } from '../../../lib/shared/contentLifecycle';
import { isSupportedManualVideoUpload } from '../../../lib/shared/contentTypeClassification';

/**
 * Does this completed campaign still need USER action — i.e. any item is a
 * manual video/reel/short upload AI cannot produce? Mirrors the calendar's own
 * "pending" predicate (pages/api/calendar/activity-events.ts): canonical
 * PENDING_CREATOR AND a supported manual video upload. Image/carousel/text are
 * AI-produced and never count. Used so the intelligent-mix post-schedule routing
 * agrees with what the calendar shows — fully-AI campaigns skip the campaign
 * calendar and land straight on the dashboard calendar.
 */
async function campaignRequiresUserAction(campaignId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('daily_content_plans')
    .select('content_status, content, content_type')
    .eq('campaign_id', campaignId)
    .limit(2000);
  if (error || !Array.isArray(data)) return false;
  for (const r of data as Array<Record<string, unknown>>) {
    const canonical = resolveCanonicalState({
      content_status: typeof r.content_status === 'string' ? r.content_status : null,
      content: (r.content ?? null) as Record<string, unknown> | string | null,
      scheduled_post_id: null,
    });
    if (
      canonical === CanonicalContentState.PENDING_CREATOR &&
      isSupportedManualVideoUpload(String(r.content_type ?? ''))
    ) {
      return true;
    }
  }
  return false;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runId = typeof req.query.run_id === 'string' ? req.query.run_id.trim() : null;
    if (!runId) {
      return res.status(400).json({ error: 'run_id is required' });
    }

    const { data: run, error } = await supabase
      .from('bolt_execution_runs')
      .select('id, company_id, current_stage, status, progress_percentage, result_campaign_id, error_message, abandonment_reason, weeks_generated, daily_slots_created, scheduled_posts_created, failed_stage')
      .eq('id', runId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch run' });
    }
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const companyId = (run as { company_id: string }).company_id;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
    });
    if (!access) return;

    const row = run as {
      current_stage: string;
      status: string;
      progress_percentage: number;
      result_campaign_id: string | null;
      error_message: string | null;
      abandonment_reason: string | null;
      weeks_generated?: number | null;
      daily_slots_created?: number | null;
      scheduled_posts_created?: number | null;
      failed_stage?: string | null;
    };

    // User-facing error resolution. Priority:
    //   1. row.error_message — real cause persisted by persistPipelineFailure
    //   2. abandonment_reason → friendly derived message — for rows the
    //      sweeper marked but where no stage ever threw a diagnostic
    //   3. undefined — when status is not failed (UI hides the field)
    //
    // This keeps forensic integrity (sweeper never touches error_message)
    // while ensuring the user always sees something useful when status=failed.
    const ABANDONMENT_MESSAGES: Record<string, string> = {
      sweeper_heartbeat_stale_inline: 'Your campaign plan was disrupted before it could complete. Please try again. If the problem persists, contact support.',
      operator_stuck_sweep: 'Your campaign plan was disrupted before it could complete. Please try again. If the problem persists, contact support.',
    };
    let userFacingError: string | undefined;
    if (row.error_message) {
      userFacingError = row.error_message;
    } else if (row.status === 'failed' && row.abandonment_reason) {
      userFacingError = ABANDONMENT_MESSAGES[row.abandonment_reason] ?? 'Your campaign plan was disrupted before it could complete. Please try again.';
    }

    const stageLabels: Record<string, string> = {
      'source-recommendation': 'Getting ready to prepare week plan',
      'ai/plan': 'Creating week plan',
      'commit-plan': 'Saving blueprint',
      'generate-weekly-structure': 'Creating daily plans',
      'schedule-structured-plan': 'Scheduling content',
      'schedule-creating-content': 'Creating content',
      'schedule-repurposing-content': 'Repurposing content',
      'schedule-writing-posts': 'Scheduling content',
    };
    // Human-readable copy for ai/plan internal milestones (see orchestrator
    // emitSubStage). The UI can fall back to the parent label if it doesn't
    // recognize a substage, so adding new ones here is forward-compatible.
    const aiPlanSubStageLabels: Record<string, string> = {
      context: 'Gathering campaign context',
      drafting: 'Drafting weekly themes',
      // Heartbeat ticks emitted every ~15s while a long-running phase is
      // pending. UI surfaces them so the screen never sits silently on a
      // static label during long provider waits.
      'still-drafting': 'Still drafting campaign strategy…',
      'still-evaluating-alignment': 'Still evaluating alignment…',
      'still-refining': 'Still refining language and tone…',
      // Parse / skeleton repair substages emitted from parseStructuredPlanWithRecovery
      // when the first LLM output couldn't be parsed or violated the deterministic
      // skeleton. They live between drafting and alignment.
      'repairing-malformed-structure': 'Repairing malformed campaign structure',
      'repairing-campaign-skeleton': 'Repairing campaign skeleton',
      'validating-repaired-campaign': 'Validating repaired campaign',
      // Legacy parent of the alignment phase — kept so older runs in flight
      // still render a sensible label after a deploy.
      scoring: 'Scoring strategic alignment',
      // Granular alignment substages emitted by the orchestrator. Each one is
      // a thin marker around a specific check or recovery step so the UI
      // never sits on a single label while multiple operations execute.
      'evaluating-alignment': 'Evaluating campaign alignment',
      'checking-psychological-progression': 'Checking psychological progression',
      'validating-content-diversity': 'Validating content diversity',
      'recovering-low-alignment-sections': 'Recovering low-alignment sections',
      'rechecking-strategic-alignment': 'Rechecking strategic alignment',
      'continuing-to-refinement': 'Continuing to refinement',
      refining: 'Refining language and tone',
    };
    // PHASE DAILY-PLAN-STAGE-VISIBILITY — intra-stage substages for the daily-plan
    // build, surfaced exactly like ai/plan substages (parent label stays stable).
    const weeklyStructureSubStageLabels: Record<string, string> = {
      preparing: 'Preparing weekly structure',
      allocating: 'Allocating content types',
      'building-rows': 'Building activity rows',
      validating: 'Validating activities',
      saving: 'Saving activities',
    };
    const stage = row.current_stage;
    let stageLabel = stageLabels[stage];
    let aiPlanSubStage: string | undefined;
    let aiPlanSubStageLabel: string | undefined;
    let weeklyStructureSubStage: string | undefined;
    let weeklyStructureSubStageLabel: string | undefined;
    if (!stageLabel && stage?.startsWith('generate-weekly-structure:')) {
      // generate-weekly-structure:<sub> — keep the parent "Creating daily plans"
      // label and surface the sub-stage separately (like ai/plan).
      stageLabel = stageLabels['generate-weekly-structure'];
      const sub = stage.slice('generate-weekly-structure:'.length);
      weeklyStructureSubStage = sub;
      weeklyStructureSubStageLabel = weeklyStructureSubStageLabels[sub];
    }
    if (!stageLabel && stage?.startsWith('ai/plan:')) {
      // ai/plan:<substage> — surface as the parent label so progress-bar
      // logic (which keys off stage === 'ai/plan') keeps working, and ship
      // the sub-stage as a separate field for the panel to render.
      stageLabel = stageLabels['ai/plan'];
      const sub = stage.slice('ai/plan:'.length);
      aiPlanSubStage = sub;
      aiPlanSubStageLabel = aiPlanSubStageLabels[sub];
    }
    if (!stageLabel && stage?.startsWith('generate-weekly-structure-week-')) {
      const weekNum = stage.replace(/\D/g, '') || '';
      stageLabel = weekNum ? `Creating daily plans (Week ${weekNum})` : 'Creating daily plans';
    }
    if (!stageLabel && stage?.startsWith('generate-weekly-structure-weeks-')) {
      stageLabel = 'Creating daily plans';
    }
    if (!stageLabel) {
      stageLabel = row.status === 'completed' ? 'Complete' : stage ? stage.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Initializing…';
    }

    // ── Phase 6H-D — failure explainability ─────────────────────────────────
    // Surface WHERE it failed (failed_stage, already persisted on
    // bolt_execution_runs by persistPipelineFailure) and, when available, the
    // BOLT error_code (from the failure event metadata). Failure-only; reuses
    // the same stageLabels authority; never exposes raw_error_message/stacks.
    let failedStageLabel: string | undefined;
    let errorCode: string | undefined;
    if (row.status === 'failed') {
      const fs = row.failed_stage ?? undefined;
      if (fs) {
        failedStageLabel =
          stageLabels[fs] ??
          (fs.startsWith('ai/plan') ? stageLabels['ai/plan'] : undefined) ??
          (fs.startsWith('generate-weekly-structure') ? stageLabels['generate-weekly-structure'] : undefined) ??
          fs.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      }
      // Optional: read the BOLT error_code from the latest failure event
      // metadata (already persisted). Read-only, guarded — never blocks polling.
      try {
        const { data: failEvt } = await supabase
          .from('bolt_execution_events')
          .select('metadata')
          .eq('run_id', runId)
          .eq('status', 'failed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const code = (failEvt?.metadata as { error_code?: unknown } | null)?.error_code;
        if (typeof code === 'string' && code.trim()) errorCode = code.trim();
      } catch {
        // optional enrichment — ignore
      }
    }

    // ── PROGRESSIVE / STREAMING STATE (Part 8) ──────────────────────────────
    // Surface recent planner events for THIS campaign so the UI can render
    // optimization badges + progressive hydration without polling additional
    // endpoints. The recent-events buffer is in-process — for a multi-instance
    // deployment, the cluster-wide event stream should be persisted to Redis
    // (deferred to a follow-up). Per-process events still cover the common
    // single-worker case and degrade gracefully.
    let progressiveState: {
      drafting_completed?: boolean;
      drafting_partial_chars?: number;
      alignment_completed?: boolean;
      alignment_score?: number | null;
      partial_salvage_used?: boolean;
      salvaged_week_count?: number;
      refinement_status?: 'inline' | 'enqueued' | 'completed' | 'skipped' | 'unknown';
      refinement_job_id?: string | null;
      overload_active?: boolean;
      plan_created?: boolean;
    } = {};
    try {
      const campaignIdForEvents = row.result_campaign_id ?? '';
      if (campaignIdForEvents) {
        const recent = plannerEventBus.recentEvents().filter((e) => e.campaign_id === campaignIdForEvents);
        progressiveState.refinement_status = 'unknown';
        for (const ev of recent) {
          switch (ev.type) {
            case 'drafting_completed':
              progressiveState.drafting_completed = true;
              progressiveState.drafting_partial_chars = Number((ev.payload as any)?.streamed_partial_chars ?? 0);
              break;
            case 'alignment_completed':
              progressiveState.alignment_completed = true;
              progressiveState.alignment_score = Number((ev.payload as any)?.alignment_score ?? null);
              break;
            case 'salvage_applied':
              progressiveState.partial_salvage_used = true;
              progressiveState.salvaged_week_count = Number((ev.payload as any)?.salvaged_week_count ?? 0);
              break;
            case 'refinement_completed':
              progressiveState.refinement_status = 'completed';
              break;
            case 'overload_mode_activated':
              progressiveState.overload_active = true;
              break;
            case 'plan_created':
              progressiveState.plan_created = true;
              if ((ev.payload as any)?.async_refinement_enqueued) {
                progressiveState.refinement_status = 'enqueued';
                progressiveState.refinement_job_id = String((ev.payload as any)?.async_refinement_job_id ?? '');
              } else {
                progressiveState.refinement_status = progressiveState.refinement_status === 'completed'
                  ? 'completed'
                  : 'inline';
              }
              break;
            case 'progressive_phase_completed':
              if ((ev.payload as any)?.phase === 'refinement_enqueued') {
                progressiveState.refinement_status = 'enqueued';
                progressiveState.refinement_job_id = String((ev.payload as any)?.job_id ?? '');
              }
              break;
          }
        }
      }
    } catch {
      // Never let progressive-state enrichment break the polling endpoint.
    }

    // Compute the fully-AI vs needs-user signal ONCE, only when the run has
    // completed and produced a campaign — drives the intelligent-mix routing.
    let requiresUserAction: boolean | undefined;
    if (row.status === 'completed' && row.result_campaign_id) {
      requiresUserAction = await campaignRequiresUserAction(row.result_campaign_id);
    }

    return res.status(200).json({
      stage: row.current_stage,
      stage_label: stageLabel,
      ai_plan_substage: aiPlanSubStage,
      ai_plan_substage_label: aiPlanSubStageLabel,
      weekly_structure_substage: weeklyStructureSubStage,
      weekly_structure_substage_label: weeklyStructureSubStageLabel,
      status: row.status,
      progress_percentage: row.progress_percentage,
      result_campaign_id: row.result_campaign_id ?? undefined,
      error_message: userFacingError,
      // Phase 6H-D — failure explainability (failure-only, friendly only).
      failed_stage: row.status === 'failed' ? (row.failed_stage ?? undefined) : undefined,
      failed_stage_label: failedStageLabel,
      error_code: errorCode,
      abandonment_reason: row.abandonment_reason ?? undefined,
      weeks_generated: row.weeks_generated ?? undefined,
      daily_slots_created: row.daily_slots_created ?? undefined,
      scheduled_posts_created: row.scheduled_posts_created ?? undefined,
      // Intelligent-mix routing: true when the campaign has manual-upload
      // (video/reel/short) items still needing the user; false = fully AI.
      requires_user_action: requiresUserAction,
      // Progressive state (Part 8). All fields optional — existing clients
      // continue to render exactly as before, new clients can opt in.
      progressive: progressiveState,
    });
  } catch (err) {
    console.error('[bolt/progress]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/bolt/progress' });
