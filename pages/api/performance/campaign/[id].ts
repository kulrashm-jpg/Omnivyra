import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { aggregateCampaignPerformance } from '../../../../backend/services/performanceFeedbackService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): bind the campaign to the caller. The owning
  // company is resolved server-side; a client-supplied companyId (the campaign
  // details UI sends one) may never name a different tenant.
  const access = await requireCampaignAccess(req, res, id);
  if (!access) return;
  const clientCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (clientCompanyId && clientCompanyId !== access.companyId) {
    return res.status(403).json({ error: 'Access denied to company' });
  }

  const result = await aggregateCampaignPerformance(id);
  if (!result) {
    return res.status(200).json({
      campaign_id: id,
      impressions: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
      engagement_rate: 0,
      expected_reach: null,
      accuracy_score: 0.5,
      recommendation_confidence: null,
      last_collected_at: null,
    });
  }

  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/performance/campaign/:id' });
