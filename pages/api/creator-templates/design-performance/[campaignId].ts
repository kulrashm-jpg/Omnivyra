import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { getCampaignDesignPerformance } from '../../../../backend/services/creator/designPerformanceService';
import { getCampaignDesignSystemCompanyId } from '../../../../backend/services/creator/campaignDesignSystemService';

/**
 * GET /api/creator-templates/design-performance/[campaignId]
 *   → deterministic performance rollups (templates / collections / campaign
 *     design system) + scores + weak families + recommendations.
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

  // Authorize on the campaign's design-system company before scanning analytics.
  const companyId = await getCampaignDesignSystemCompanyId(campaignId);
  if (!companyId) return res.status(404).json({ error: 'no design system attached' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const performance = await getCampaignDesignPerformance(campaignId);
  return res.status(200).json({ performance });
}
