import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = (req.query.id ?? req.query.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const { data: job, error: jobError } = await supabase
    .from('recommendation_jobs_v2')
    .select('id, company_id, status, progress_stage, strategic_payload, selected_pillars, regions, region_results, consolidated_result, error, created_at, updated_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: job.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const consolidated = (job.consolidated_result ?? {}) as { confidence_index?: number };
  return res.status(200).json({
    jobId: job.id,
    status: job.status,
    progress_stage: job.progress_stage ?? null,
    confidence_index: consolidated.confidence_index ?? undefined,
    region_results: job.region_results ?? {},
    consolidated_result: job.consolidated_result ?? null,
    error: job.error ?? null,
    regions: job.regions ?? [],
    created_at: job.created_at,
    updated_at: job.updated_at,
  });
}
