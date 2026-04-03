
/**
 * Campaign Plan Status Poller
 *
 * GET /api/campaigns/ai/plan-status/[jobId]
 *
 * Returns job status + partial/full result once available.
 * Frontend polls this every 2–5 seconds after POSTing to plan-v2.
 *
 * Response shape:
 * {
 *   jobId:      string
 *   status:     'pending' | 'processing' | 'layer1' | 'layer2' | 'layer3' | 'layer4' | 'complete' | 'failed'
 *   progress:   number (0–100)
 *   result?:    { blueprint: ..., total_posts: number, confidence: number }
 *   error?:     string
 *   updatedAt:  string
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { getUserCompanyRole } from '../../../../../backend/services/rbacService';

const PROGRESS_MAP: Record<string, number> = {
  pending:    5,
  processing: 10,
  layer1:     20,
  layer2:     45,
  layer3:     75,
  layer4:     90,
  complete:   100,
  failed:     0,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { jobId } = req.query;
  if (typeof jobId !== 'string' || !jobId) {
    return res.status(400).json({ error: 'Invalid jobId' });
  }

  // Fetch campaign_id from job first, then verify company access
  const { data: jobRow } = await supabase
    .from('campaign_plan_jobs')
    .select('id, campaign_id, status, partial_result, updated_at')
    .eq('id', jobId)
    .maybeSingle();

  if (!jobRow) return res.status(404).json({ error: 'Job not found' });

  // Verify user has access to the campaign's company
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('user_id')
    .eq('id', jobRow.campaign_id)
    .maybeSingle();

  if (campaign?.user_id) {
    const access = await getUserCompanyRole(req, campaign.user_id);
    if (!access.userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  // ── Job already fetched above ──────────────────────────────────────────────
  const job = jobRow;

  const progress = PROGRESS_MAP[job.status] ?? 0;
  const base = {
    jobId:      job.id,
    campaignId: job.campaign_id,
    status:     job.status,
    progress,
    updatedAt:  job.updated_at,
  };

  // ── On failure: return error ──────────────────────────────────────────────
  if (job.status === 'failed') {
    return res.status(200).json({
      ...base,
      error: (job.partial_result as any)?.error ?? 'Plan generation failed',
    });
  }

  // ── On complete: fetch full plan ──────────────────────────────────────────
  if (job.status === 'complete') {
    const { data: plan } = await supabase
      .from('twelve_week_plan')
      .select('blueprint, snapshot_hash, created_at')
      .eq('campaign_id', job.campaign_id)
      .eq('source', 'v2_pipeline')
      .maybeSingle();

    if (!plan) {
      // Shouldn't happen, but handle gracefully
      return res.status(200).json({ ...base, status: 'processing', progress: 95 });
    }

    return res.status(200).json({
      ...base,
      result: {
        blueprint:   plan.blueprint,
        total_posts: (plan.blueprint as any)?.total_posts ?? 0,
        confidence:  (plan.blueprint as any)?.confidence ?? 0,
        gpt_used:    (plan.blueprint as any)?.gpt_used ?? false,
        generated_at: plan.created_at,
      },
    });
  }

  // ── In-progress: return partial result if any ─────────────────────────────
  return res.status(200).json({
    ...base,
    partial: job.partial_result ?? null,
  });
}
