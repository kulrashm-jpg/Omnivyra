import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { analyzeCampaignEvolution } from '../../../../backend/services/creator/designEvolutionService';
import { getCampaignDesignSystemCompanyId } from '../../../../backend/services/creator/campaignDesignSystemService';

/**
 * GET /api/creator-templates/design-evolution/[campaignId]
 *   → deterministic evolution analysis (strengths / weaknesses / recommendations)
 *   for the campaign's pinned collection. Read-only — never mutates.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const campaignId = String(req.query.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  // Authorize on the campaign's design-system company before analysis.
  const companyId = await getCampaignDesignSystemCompanyId(campaignId);
  if (!companyId) return res.status(404).json({ error: 'no design system attached' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const analysis = await analyzeCampaignEvolution(campaignId);
  return res.status(200).json({ analysis });
}
