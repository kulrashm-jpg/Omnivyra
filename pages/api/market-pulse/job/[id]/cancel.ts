import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../../backend/services/userContextService';
import { supabase } from '../../../../../backend/db/supabaseClient';

const CANCELLED_ERROR = 'Cancelled by user';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = (req.query.id ?? req.query.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const { data: job, error: jobError } = await supabase
    .from('market_pulse_jobs_v1')
    .select('id, company_id, status')
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

  if (job.status !== 'PENDING' && job.status !== 'RUNNING') {
    return res.status(400).json({ error: 'Job is already finished and cannot be cancelled' });
  }

  const { error: updateError } = await supabase
    .from('market_pulse_jobs_v1')
    .update({
      status: 'FAILED',
      error: CANCELLED_ERROR,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['PENDING', 'RUNNING']);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to cancel job' });
  }

  return res.status(200).json({ cancelled: true, status: 'FAILED' });
}
