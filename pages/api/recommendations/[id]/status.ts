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
    .from('recommendation_jobs')
    .select('id, company_id, status, regions, created_at, updated_at')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: job.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const { data: signals } = await supabase
    .from('recommendation_raw_signals')
    .select('id, region_code, api_id, status, created_at')
    .eq('job_id', jobId);

  const signalsList = (signals ?? []) as { id: string; region_code: string; api_id: string; status: string; created_at: string }[];
  const byRegion = signalsList.reduce<Record<string, { success: number; failed: number }>>((acc, s) => {
    const r = s.region_code;
    if (!acc[r]) acc[r] = { success: 0, failed: 0 };
    if (s.status === 'SUCCESS') acc[r].success += 1;
    else acc[r].failed += 1;
    return acc;
  }, {});

  return res.status(200).json({
    jobId: job.id,
    status: job.status,
    regions: job.regions ?? [],
    created_at: job.created_at,
    updated_at: job.updated_at,
    signals_count: signalsList.length,
    signals_by_region: byRegion,
    partial_signals: signalsList.map((s) => ({
      region_code: s.region_code,
      api_id: s.api_id,
      status: s.status,
      created_at: s.created_at,
    })),
  });
}
