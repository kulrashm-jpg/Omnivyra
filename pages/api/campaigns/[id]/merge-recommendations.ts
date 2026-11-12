import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { mergeRecommendationsIntoPlan } from '../../../../backend/services/campaignRecommendationExtensionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  // TENANT (e9, BLOCKING): this route took the company from campaign_versions and, when that read
  // found nothing (or FAILED, unread), from the request BODY, then authorized the caller against that
  // company without binding the campaign to it (requireCampaignId:false). A member of A could pass
  // their own company with B's company-less campaign and merge into B's plan. The campaign is now
  // bound by requireCampaignAccess: its company is resolved server-side (campaign_versions, then
  // campaigns.company_id) and the caller's membership in exactly that company is proven; a lookup
  // failure is refused (fail-closed). A body companyId is only ever a claim that must MATCH.
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;
  const claimedCompanyId = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
  if (claimedCompanyId && claimedCompanyId !== access.companyId) {
    return res.status(403).json({ code: 'CAMPAIGN_NOT_IN_COMPANY', error: 'Campaign does not belong to the given company' });
  }

  const { sessionId, weekNumbers } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const weeks = Array.isArray(weekNumbers) ? weekNumbers : [];
  if (weeks.length === 0) {
    return res.status(400).json({ error: 'weekNumbers array is required and must not be empty' });
  }

  try {
    const { merged } = await mergeRecommendationsIntoPlan({
      campaignId,
      sessionId,
      weekNumbers: weeks,
    });
    return res.status(200).json({ success: true, merged });
  } catch (error: any) {
    console.error('Error merging recommendations:', error);
    return res.status(500).json({ error: error?.message || 'Failed to merge recommendations' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/merge-recommendations' });
