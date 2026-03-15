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
      .select('id, company_id, current_stage, status, progress_percentage, result_campaign_id, error_message, weeks_generated, daily_slots_created, scheduled_posts_created')
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
      weeks_generated?: number | null;
      daily_slots_created?: number | null;
      scheduled_posts_created?: number | null;
    };

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
    const stage = row.current_stage;
    let stageLabel = stageLabels[stage];
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
      status: row.status,
      progress_percentage: row.progress_percentage,
      result_campaign_id: row.result_campaign_id ?? undefined,
      error_message: row.error_message ?? undefined,
      weeks_generated: row.weeks_generated ?? undefined,
      daily_slots_created: row.daily_slots_created ?? undefined,
      scheduled_posts_created: row.scheduled_posts_created ?? undefined,
    });
  } catch (err) {
    console.error('[bolt/progress]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
