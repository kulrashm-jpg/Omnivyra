import type { NextApiRequest, NextApiResponse } from 'next';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber } = req.query;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: typeof companyId === 'string' ? companyId : undefined,
      campaignId: typeof campaignId === 'string' ? campaignId : undefined,
      requireCampaignId: true,
    });
    if (!access) return;
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const week = weekNumber ? Number(weekNumber) : undefined;
    const assets = await listAssetsWithLatestContent({ campaignId, weekNumber: week });
    return res.status(200).json({ assets });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to list content assets' });
  }
}
