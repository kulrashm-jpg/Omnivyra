import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getLatestCampaignVersion } from '../../../backend/db/campaignVersionStore';
import { getLatestPlatformExecutionPlan } from '../../../backend/db/platformExecutionStore';
import { generateContentForDay } from '../../../backend/services/contentGenerationService';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';
import { createContentAsset } from '../../../backend/services/contentAssetService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber, day } = req.body || {};
    if (!companyId || !campaignId || !weekNumber || !day) {
      return res.status(400).json({ error: 'companyId, campaignId, weekNumber, day are required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
    if (!campaignVersion?.campaign_snapshot?.weekly_plan) {
      return res.status(404).json({ error: 'Campaign plan not found' });
    }

    const weekPlan = campaignVersion.campaign_snapshot.weekly_plan.find(
      (week: any) => week.week_number === Number(weekNumber)
    );
    if (!weekPlan) {
      return res.status(404).json({ error: 'Week plan not found' });
    }

    const execution = await getLatestPlatformExecutionPlan({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
    });
    const dayPlan = execution?.plan_json?.days?.find((entry: any) => entry.date === day);
    if (!dayPlan) {
      return res.status(404).json({ error: 'Day plan not found' });
    }

    const content = await generateContentForDay({
      companyProfile: profile,
      campaign: campaignVersion.campaign_snapshot.campaign ?? campaignVersion.campaign_snapshot,
      weekPlan,
      dayPlan,
      trend: dayPlan.trendUsed ?? null,
      platform: dayPlan.platform,
      campaignMemory: await getCampaignMemory({ companyId, campaignId }),
    });

    const asset = await createContentAsset({
      campaignId,
      weekNumber: Number(weekNumber),
      day,
      platform: dayPlan.platform,
      content,
    });

    return res.status(200).json(asset);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate content' });
  }
}
