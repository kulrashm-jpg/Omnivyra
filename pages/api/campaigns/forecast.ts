import type { NextApiRequest, NextApiResponse } from 'next';
import { getLatestCampaignVersion, getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import { getLatestPlatformExecutionPlan } from '../../../backend/db/platformExecutionStore';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';
import { getLatestAnalyticsReport } from '../../../backend/db/performanceStore';
import { generateCampaignForecast } from '../../../backend/services/campaignForecastService';
import { saveCampaignForecast } from '../../../backend/db/forecastStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId } = req.body || {};
    if (!companyId || !campaignId) {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }

    const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
    if (!campaignVersion?.campaign_snapshot) {
      return res.status(404).json({ error: 'Campaign plan not found' });
    }
    const platformPlan = await getLatestPlatformExecutionPlan({ companyId, campaignId, weekNumber: 1 });
    const assets = await listAssetsWithLatestContent({ campaignId });
    const trends = await getTrendSnapshots(companyId, campaignId);
    const memory = await getCampaignMemory({ companyId, campaignId });
    const analytics = await getLatestAnalyticsReport(companyId, campaignId);

    const forecast = await generateCampaignForecast({
      companyId,
      campaignId,
      campaignPlan: campaignVersion.campaign_snapshot,
      platformExecutionPlan: platformPlan?.plan_json ?? null,
      contentAssets: assets,
      trendsUsed: trends.flatMap((snap) => snap.snapshot?.emerging_trends ?? []).map((t: any) => t.topic),
      campaignMemory: memory,
      analyticsHistory: analytics?.report_json ?? null,
    });

    await saveCampaignForecast({
      campaignId,
      forecast,
      confidence: forecast.confidence,
    });
    console.log('FORECAST GENERATED', { campaignId });

    return res.status(200).json(forecast);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate forecast' });
  }
}
