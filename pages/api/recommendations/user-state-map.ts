import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * GET /api/recommendations/user-state-map?companyId=...
 * Returns recommendation_id -> state (ACTIVE | ARCHIVED | LONG_TERM) for the company.
 * Used by TrendCampaignsTab for filtering and ranking.
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
    .select('recommendation_id, state')
    .eq('organization_id', companyId);

  if (error) {
    return res.status(500).json({ error: 'Failed to load recommendation user state' });
  }

  const stateMap: Record<string, string> = {};
  (rows || []).forEach((row: { recommendation_id: string; state: string }) => {
    if (row?.recommendation_id && row?.state) {
      stateMap[String(row.recommendation_id)] = String(row.state);
    }
  });

  return res.status(200).json(stateMap);
}
