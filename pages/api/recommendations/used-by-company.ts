import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';

/**
 * GET /api/recommendations/used-by-company?companyId=...
 * Returns recommendation snapshot IDs that this company has already used to create a campaign.
 * Used by the Trend tab to hide those themes from the list.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
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
    .from('campaign_versions')
    .select('campaign_snapshot')
    .eq('company_id', companyId);

  if (error) {
    console.warn('used-by-company campaign_versions', error.message);
    return res.status(500).json({ error: 'Failed to load campaign versions' });
  }

  const usedIds = new Set<string>();
  for (const row of rows ?? []) {
    const snap = (row?.campaign_snapshot ?? {}) as {
      source_recommendation_id?: string | null;
      metadata?: { recommendation_id?: string | null };
    };
    const id1 = typeof snap.source_recommendation_id === 'string' ? snap.source_recommendation_id.trim() : '';
    const id2 = typeof snap.metadata?.recommendation_id === 'string' ? snap.metadata.recommendation_id.trim() : '';
    if (id1) usedIds.add(id1);
    if (id2) usedIds.add(id2);
  }

  return res.status(200).json({ usedRecommendationIds: Array.from(usedIds) });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);
