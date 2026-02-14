import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId ?? req.query.company_id) as string;
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const { data: rows, error } = await supabase
    .from('recommendation_jobs_v2')
    .select('id, status, regions, consolidated_result, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: 'Failed to load job history' });
  }

  const jobs = (rows ?? []).map((row: { id: string; status: string; regions: string[]; consolidated_result: { confidence_index?: number } | null; created_at: string }) => ({
    jobId: row.id,
    status: row.status,
    regions: Array.isArray(row.regions) ? row.regions : [],
    confidence_index: row.consolidated_result?.confidence_index ?? null,
    created_at: row.created_at,
  }));

  return res.status(200).json({ jobs });
}
