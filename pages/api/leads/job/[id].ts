import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getTopClusters } from '../../../../backend/services/leadClusterService';

const FUNNEL_LEADS_LIMIT = 100;

const FUNNEL_STATUSES = [
  'ACTIVE',
  'WATCHLIST',
  'OUTREACH_PLANNED',
  'OUTREACH_SENT',
  'ENGAGED',
  'CONVERTED',
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = (req.query.id ?? req.query.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const { data: job, error: jobError } = await supabase
    .from('lead_jobs_v1')
    .select('id, company_id, status, mode, total_found, total_qualified, confidence_index, error, progress_stage, created_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    console.warn('Lead job not found', { jobId, jobError: jobError?.message });
    return res.status(404).json({ error: 'Job not found', jobId });
  }

  res.setHeader('Cache-Control', 'no-store');

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: job.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const { data: leads } = await supabase
    .from('lead_signals_v1')
    .select('id, platform, region, snippet, source_url, author_handle, icp_score, urgency_score, intent_score, total_score, engagement_potential, risk_flag, signal_type, trend_velocity, conversion_window_days, status, converted_at, post_created_at, problem_domain, created_at')
    .eq('job_id', jobId)
    .in('status', [...FUNNEL_STATUSES])
    .limit(FUNNEL_LEADS_LIMIT);

  const decayMultiplier = (postCreatedAt: string | null | undefined): number => {
    if (!postCreatedAt) return 1.0;
    const days = (Date.now() - new Date(postCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 2) return 1.0;
    if (days <= 7) return 0.85;
    if (days <= 14) return 0.6;
    return 0.35;
  };

  const enriched = (leads ?? []).map((lead) => {
    const total = Number(lead.total_score ?? 0);
    const mult = decayMultiplier(lead.post_created_at);
    const effective = total * mult;
    return { ...lead, total_score: total, effective_score: effective };
  });

  enriched.sort((a, b) => (b.effective_score ?? 0) - (a.effective_score ?? 0));

  const clusters = await getTopClusters(job.company_id);

  return res.status(200).json({
    status: job.status,
    progress_stage: job.progress_stage ?? null,
    mode: job.mode ?? 'REACTIVE',
    total_found: job.total_found ?? 0,
    total_qualified: job.total_qualified ?? 0,
    confidence_index: job.confidence_index ?? 0,
    results: enriched,
    clusters,
    error: job.error ?? null,
    created_at: (job as { created_at?: string }).created_at ?? null,
  });
}
