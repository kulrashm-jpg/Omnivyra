
/**
 * GET /api/bolt/progress?run_id=<id>
 *
 * Returns current stage, status, and progress for a BOLT run.
 * Used by UI to poll for real-time execution progress.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      .select('id, company_id, current_stage, status, progress_percentage, result_campaign_id, error_message, abandonment_reason, weeks_generated, daily_slots_created, scheduled_posts_created')
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
      scoring: 'Scoring strategic alignment',
      refining: 'Refining language and tone',
    };
    const stage = row.current_stage;
    let stageLabel = stageLabels[stage];
    let aiPlanSubStage: string | undefined;
    let aiPlanSubStageLabel: string | undefined;
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

    return res.status(200).json({
      stage: row.current_stage,
      stage_label: stageLabel,
      ai_plan_substage: aiPlanSubStage,
      ai_plan_substage_label: aiPlanSubStageLabel,
      status: row.status,
      progress_percentage: row.progress_percentage,
      result_campaign_id: row.result_campaign_id ?? undefined,
      error_message: userFacingError,
      abandonment_reason: row.abandonment_reason ?? undefined,
      weeks_generated: row.weeks_generated ?? undefined,
      daily_slots_created: row.daily_slots_created ?? undefined,
      scheduled_posts_created: row.scheduled_posts_created ?? undefined,
    });
  } catch (err) {
    console.error('[bolt/progress]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
