import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * GET /api/recommendations/user-state-counts?companyId=...
 * Returns counts by state (ACTIVE, ARCHIVED, LONG_TERM) for the company.
 * Used by Recommendation Status dashboard widget.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const { data: rows, error } = await supabase
    .from('recommendation_user_state')
    .select('state')
    .eq('organization_id', companyId);

  if (error) {
    return res.status(500).json({ error: 'Failed to load recommendation state counts' });
  }

  const counts = { ACTIVE: 0, ARCHIVED: 0, LONG_TERM: 0 };
  (rows || []).forEach((row: { state: string }) => {
    const s = row?.state ? String(row.state).toUpperCase() : '';
    if (s === 'ACTIVE') counts.ACTIVE++;
    else if (s === 'ARCHIVED') counts.ARCHIVED++;
    else if (s === 'LONG_TERM') counts.LONG_TERM++;
  });

  return res.status(200).json(counts);
}
