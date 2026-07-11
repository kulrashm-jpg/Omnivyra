/**
 * GET /api/campaigns/[id]/assignment-execution-events — Strategic Mix P5.
 *
 * Read-only derivation of execution events from the engine's EXISTING
 * canonical records (daily_content_plans + scheduled_posts + campaign
 * completion). Strategic Mix OBSERVES execution rather than replacing it:
 * nothing here writes, schedules, publishes, or duplicates state — the
 * event list is re-derived on demand (no polling, no timers, no second
 * lifecycle tracker), and the client folds it onto the assignments with
 * the pure applyExecutionEvents reducer.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCampaignTenantAccess } from '../../../../backend/security/TenantGuard';
import {
  deriveExecutionEvents,
  type ExecutionPlanRowFact,
  type ScheduledPostFact,
} from '../../../../lib/campaign/assignmentExecutionSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  const campaignId = typeof id === 'string' ? id.trim() : '';
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID is required' });

  const access = await requireCampaignTenantAccess(req, res, campaignId);
  if (!access) return;

  try {
    const [{ data: campaign }, { data: planRows }, { data: posts }] = await Promise.all([
      supabase.from('campaigns').select('execution_status').eq('id', campaignId).maybeSingle(),
      supabase
        .from('daily_content_plans')
        .select('execution_id, scheduled_post_id, content_status')
        .eq('campaign_id', campaignId),
      supabase
        .from('scheduled_posts')
        .select('id, status, error_message, error_code, published_at')
        .eq('campaign_id', campaignId),
    ]);

    const events = deriveExecutionEvents({
      campaignId,
      planRows: (Array.isArray(planRows) ? planRows : []) as ExecutionPlanRowFact[],
      posts: (Array.isArray(posts) ? posts : []) as ScheduledPostFact[],
      campaignCompleted:
        String((campaign as { execution_status?: unknown } | null)?.execution_status ?? '').toUpperCase() === 'COMPLETED',
    });

    return res.status(200).json({
      events,
      derived_from: {
        plan_rows: Array.isArray(planRows) ? planRows.length : 0,
        scheduled_posts: Array.isArray(posts) ? posts.length : 0,
        campaign_completed:
          String((campaign as { execution_status?: unknown } | null)?.execution_status ?? '').toUpperCase() === 'COMPLETED',
      },
    });
  } catch (err) {
    console.error('[assignment-execution-events] derivation failed:', (err as Error)?.message ?? err);
    return res.status(500).json({ error: 'Failed to derive execution events' });
  }
}
