import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { getCampaignDesignPerformance } from '../../../../backend/services/creator/designPerformanceService';
import { getCampaignDesignSystemCompanyId } from '../../../../backend/services/creator/campaignDesignSystemService';

/**
 * GET /api/creator-templates/design-performance/[campaignId]
 *   → deterministic performance rollups (templates / collections / campaign
 *     design system) + scores + weak families + recommendations.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const campaignId = String(req.query.campaignId || '').trim();
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

  // ROUTE-AUTH-001 (STEP 3AH-85) — authorize on the CAMPAIGN's owning company
  // (campaign_versions), not on the design-system row, which is keyed by
  // campaign_id alone and could be written under another company. A row that
  // is not the campaign's own counts as no design system.
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;
  const companyId = await getCampaignDesignSystemCompanyId(campaignId);
  if (!companyId || companyId !== access.companyId) return res.status(404).json({ error: 'no design system attached' });

  const performance = await getCampaignDesignPerformance(campaignId);
  return res.status(200).json({ performance });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/design-performance/:campaignId' });
