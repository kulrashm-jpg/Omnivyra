import type { NextApiRequest, NextApiResponse } from 'next';
import { generateCampaignAuditReport } from '../../../backend/services/campaignAuditService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId } = req.body || {};
    const report = await generateCampaignAuditReport(companyId, campaignId);
    return res.status(200).json(report);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate audit report' });
  }
}
