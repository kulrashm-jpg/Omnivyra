import { getLatestCampaignVersion, getTrendSnapshots } from '../db/campaignVersionStore';
import { listAssetsWithLatestContent } from '../db/contentAssetStore';
import { getLatestAnalyticsReport, getLatestLearningInsights } from '../db/performanceStore';
import { saveCampaignMemorySnapshot } from '../db/campaignMemoryStore';

export async function getCampaignMemory(input: {
  companyId: string;
  lookbackPeriod?: string;
  campaignId?: string;
}): Promise<{
  pastThemes: string[];
  pastTopics: string[];
  pastHooks: string[];
  pastTrendsUsed: string[];
  pastPlatforms: string[];
  pastContentSummaries: string[];
}> {
  const campaignVersion = await getLatestCampaignVersion(input.companyId, input.campaignId);
  const weeklyPlans = campaignVersion?.campaign_snapshot?.weekly_plan ?? [];
  const dailyPlans = campaignVersion?.campaign_snapshot?.daily_plan ?? [];
  const trends = await getTrendSnapshots(input.companyId, input.campaignId);
  const assets = input.campaignId
    ? await listAssetsWithLatestContent({ campaignId: input.campaignId })
    : [];
  const analytics = await getLatestAnalyticsReport(input.companyId, input.campaignId);
  const learning = await getLatestLearningInsights(input.companyId, input.campaignId);

  const pastThemes = weeklyPlans.map((week: any) => week.theme).filter(Boolean);
  const pastTopics = dailyPlans.map((day: any) => day.topic).filter(Boolean);
  const pastHooks = assets.map((asset) => asset.latest_content?.hook).filter(Boolean);
  const pastTrendsUsed = trends
    .flatMap((snap) => snap.snapshot?.emerging_trends ?? [])
    .map((trend: any) => trend?.topic)
    .filter(Boolean);
  const pastPlatforms = dailyPlans.map((day: any) => day.platform).filter(Boolean);
  const pastContentSummaries = assets
    .map((asset) => asset.latest_content?.caption || asset.latest_content?.headline)
    .filter(Boolean);

  const memory = {
    pastThemes,
    pastTopics,
    pastHooks,
    pastTrendsUsed,
    pastPlatforms,
    pastContentSummaries,
    analytics: analytics?.report_json ?? null,
    learning: learning?.insights_json ?? null,
  };

  await saveCampaignMemorySnapshot({ companyId: input.companyId, memory });
  console.log('PAST CAMPAIGNS USED FOR CONTEXT', { companyId: input.companyId });

  return {
    pastThemes,
    pastTopics,
    pastHooks,
    pastTrendsUsed,
    pastPlatforms,
    pastContentSummaries,
  };
}
