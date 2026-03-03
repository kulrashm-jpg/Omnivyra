import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { computeAnalytics } from '../../../backend/services/analyticsService';
import { generateLearningInsights } from '../../../backend/services/learningEngineService';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const companyId = access.companyId;
    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const analytics = await computeAnalytics({ companyId, campaignId: access.campaignId, timeframe: 'latest' });
    const campaignVersion = await getLatestApprovedCampaignVersion(companyId, access.campaignId);
    const campaign = campaignVersion?.campaign_snapshot?.campaign ?? {};
    console.debug('Approved strategy used for analytics', {
      campaignId: access.campaignId,
      companyId,
      versionId: campaignVersion?.id,
      status: campaignVersion?.status,
    });

    const insights = await generateLearningInsights({
      analytics,
      companyProfile: profile,
      campaign,
      companyId,
      campaignId: access.campaignId,
    });
    return res.status(200).json(insights);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate insights' });
  }
}
