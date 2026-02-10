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

  if (job.status !== 'COMPLETED' && job.status !== 'FAILED') {
    return res.status(200).json({
      jobId: job.id,
      status: job.status,
      result: null,
      message: job.status === 'FAILED' ? 'Job failed.' : 'Analysis not ready yet.',
    });
  }

  const { data: analysis, error: analysisError } = await supabase
    .from('recommendation_analysis')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (analysisError || !analysis) {
    return res.status(200).json({
      jobId: job.id,
      status: job.status,
      result: null,
      consolidated_recommendation: null,
      disclaimer_text: null,
      divergence_score: null,
      confidence_score: null,
      message: job.status === 'FAILED' ? 'Job failed.' : 'No analysis available.',
    });
  }

  const consolidated = (analysis as { consolidated_recommendation_json?: unknown }).consolidated_recommendation_json ?? {};
  return res.status(200).json({
    jobId: job.id,
    status: job.status,
    result: {
      consolidated_recommendation_json: consolidated,
      divergence_score: (analysis as { divergence_score?: number }).divergence_score ?? null,
      disclaimer_text: (analysis as { disclaimer_text?: string | null }).disclaimer_text ?? null,
      confidence_score: (analysis as { confidence_score?: number }).confidence_score ?? null,
    },
    consolidated_recommendation: consolidated,
    disclaimer_text: (analysis as { disclaimer_text?: string | null }).disclaimer_text ?? null,
    divergence_score: (analysis as { divergence_score?: number }).divergence_score ?? null,
    confidence_score: (analysis as { confidence_score?: number }).confidence_score ?? null,
  });
}
