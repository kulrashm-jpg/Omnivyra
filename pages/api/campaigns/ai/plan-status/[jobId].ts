import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';

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
import { enforceCompanyAccessUniform, resolveUserContext, UNIFORM_NOT_FOUND } from '../../../../../backend/services/userContextService';

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth (SECURITY, 2026-11-12) ───────────────────────────────────────────
  // Before: the job's partial/full plan was returned to ANY signed-in user. The check passed the
  // campaign's user_id as a companyId to getUserCompanyRole and then tested only that the caller was
  // authenticated; and a failed (or owner-less) campaign read skipped even that. Now:
  //   1. authenticate first (401 before any read);
  //   2. read the job and its campaign's COMPANY, every read checked (a store error is 503, never
  //      "no access check");
  //   3. require membership of that company via enforceCompanyAccess (campaign bound);
  //   4. an unknown job, a job without a resolvable company, and another company's job all answer
  //      the SAME 404 (no existence oracle).
  const { jobId } = req.query;
  if (typeof jobId !== 'string' || !jobId) {
    return res.status(400).json({ error: 'Invalid jobId' });
  }

  const user = await resolveUserContext(req);
  if (user.authenticated === false) {
    return res.status(401).json({ error: 'Authentication required. Please sign in again.', code: 'UNAUTHENTICATED' });
  }

  const { data: jobRow, error: jobError } = await supabase
    .from('campaign_plan_jobs')
    .select('id, campaign_id, status, partial_result, updated_at')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) return res.status(503).json({ error: 'Plan job could not be read. Please retry.', code: 'PLAN_JOB_UNAVAILABLE', retryable: true });
  if (!jobRow) return res.status(404).json(UNIFORM_NOT_FOUND);

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', jobRow.campaign_id)
    .maybeSingle();
  if (campaignError) return res.status(503).json({ error: 'Campaign could not be read. Please retry.', code: 'CAMPAIGN_UNAVAILABLE', retryable: true });
  const companyId = (campaign as { company_id?: string | null } | null)?.company_id ?? null;
  if (!companyId) return res.status(404).json(UNIFORM_NOT_FOUND);

  const access = await enforceCompanyAccessUniform({ req, res, companyId, campaignId: jobRow.campaign_id });
  if (!access) return;
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
    const { data: plan, error: planError } = await supabase
      .from('campaign_week_plan')
      .select('blueprint, snapshot_hash, created_at')
      .eq('campaign_id', job.campaign_id)
      .eq('source', 'v2_pipeline')
      .maybeSingle();
    // A failed read is an error, never "still processing at 95%" forever.
    if (planError) return res.status(503).json({ ...base, error: 'Plan could not be read. Please retry.', code: 'PLAN_UNAVAILABLE', retryable: true });

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/ai/plan-status/:jobId' });
