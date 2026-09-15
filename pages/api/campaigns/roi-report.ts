import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { calculateROI } from '../../../backend/services/roiService';
import { saveRoiReport } from '../../../backend/db/forecastStore';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, costInputs, performanceMetrics } = req.body || {};
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    // ROUTE-AUTH-001: authenticate and bind the campaign before computing or saving.
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;
    const roi = calculateROI({ campaignId: access.campaignId, costInputs: costInputs ?? {}, performanceMetrics });
    await saveRoiReport({ campaignId: access.campaignId, roi });
    console.log('ROI CALCULATED', { campaignId: access.campaignId });
    return res.status(200).json(roi);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to calculate ROI' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/roi-report' });
