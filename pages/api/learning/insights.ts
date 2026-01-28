import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { computeAnalytics } from '../../../backend/services/analyticsService';
import { generateLearningInsights } from '../../../backend/services/learningEngineService';
import { getLatestCampaignVersion } from '../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const analytics = await computeAnalytics({ companyId, campaignId, timeframe: 'latest' });
    const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
    const campaign = campaignVersion?.campaign_snapshot?.campaign ?? {};

    const insights = await generateLearningInsights({
      analytics,
      companyProfile: profile,
      campaign,
      companyId,
      campaignId,
    });
    return res.status(200).json(insights);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate insights' });
  }
}
