import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

/**
 * GET /api/recommendations/strategy-signals?companyId=...
 * Returns aggregated strategy metrics for a company:
 * - archived, longTerm (strategic backlog), adopted (ideas adopted into campaigns),
 * - totalRecommendations, adoptionRate (%)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
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

  let archived = 0;
  let longTerm = 0;
  let totalRecommendations = 0;
  let adopted = 0;

  // Query 1 — Archived
  const { count: archivedCount, error: archivedErr } = await supabase
    .from('recommendation_user_state')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', companyId)
    .eq('state', 'ARCHIVED');

  if (!archivedErr && archivedCount != null) archived = archivedCount;

  // Query 2 — Strategic Backlog (LONG_TERM)
  const { count: longTermCount, error: longTermErr } = await supabase
    .from('recommendation_user_state')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', companyId)
    .eq('state', 'LONG_TERM');

  if (!longTermErr && longTermCount != null) longTerm = longTermCount;

  // Query 3 — Total Recommendations
  const { count: totalCount, error: totalErr } = await supabase
    .from('recommendation_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId);

  if (!totalErr && totalCount != null) totalRecommendations = totalCount;

  // Query 4 — Adopted (campaigns created from recommendations)
  const { data: cvRows, error: cvErr } = await supabase
    .from('campaign_versions')
    .select('campaign_snapshot')
    .eq('company_id', companyId);

  if (!cvErr && Array.isArray(cvRows)) {
    adopted = cvRows.filter((row) => {
      const snap = (row?.campaign_snapshot ?? {}) as {
        source_recommendation_id?: string | null;
        metadata?: { recommendation_id?: string | null };
      };
      const id1 = typeof snap.source_recommendation_id === 'string' ? snap.source_recommendation_id.trim() : '';
      const id2 = typeof snap.metadata?.recommendation_id === 'string' ? snap.metadata.recommendation_id.trim() : '';
      return !!(id1 || id2);
    }).length;
  }

  // Adoption rate: adopted / total_recommendations, as percentage (integer)
  const adoptionRate =
    totalRecommendations > 0 ? Math.round((adopted / totalRecommendations) * 100) : 0;

  return res.status(200).json({
    archived,
    longTerm,
    adopted,
    totalRecommendations,
    adoptionRate,
  });
}
