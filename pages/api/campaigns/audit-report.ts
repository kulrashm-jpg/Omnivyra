import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateCampaignAuditReport } from '../../../backend/services/campaignAuditService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId } = req.body || {};
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const report = await generateCampaignAuditReport(access.companyId, access.campaignId);
    return res.status(200).json(report);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate audit report' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/audit-report' });
