import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getLatestCampaignVersion } from '../../../backend/db/campaignVersionStore';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import {
  buildPlatformExecutionPlan,
} from '../../../backend/services/platformIntelligenceService';
import {
  getLatestPlatformExecutionPlan,
  savePlatformExecutionPlan,
  saveSchedulerJobs,
} from '../../../backend/db/platformExecutionStore';
import { buildSchedulerPayload } from '../../../backend/services/schedulerPayloadBuilder';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getComplianceReport, getPlatformVariant, getPromotionMetadata } from '../../../backend/db/platformPromotionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber } = req.body || {};
    if (!companyId || !weekNumber) {
      return res.status(400).json({ error: 'companyId and weekNumber are required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    let plan = await getLatestPlatformExecutionPlan({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
    });

    if (!plan?.plan_json) {
      const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
      if (!campaignVersion?.campaign_snapshot?.weekly_plan) {
        return res.status(404).json({ error: 'Campaign plan not found' });
      }

      const weeklyPlan = campaignVersion.campaign_snapshot.weekly_plan.find(
        (week: any) => week.week_number === Number(weekNumber)
      );
      if (!weeklyPlan) {
        return res.status(404).json({ error: 'Week plan not found' });
      }

      const trendSnapshots = await getTrendSnapshots(companyId, campaignId);
      const trends = trendSnapshots
        .flatMap((snap) => snap.snapshot?.emerging_trends ?? [])
        .map((trend: any) => trend?.topic)
        .filter(Boolean);

      const builtPlan = buildPlatformExecutionPlan({
        companyProfile: profile,
        campaign: campaignVersion.campaign_snapshot.campaign ?? campaignVersion.campaign_snapshot,
        weekPlan: weeklyPlan,
        trends,
      });
      await savePlatformExecutionPlan({
        companyId,
        campaignId,
        weekNumber: Number(weekNumber),
        planJson: builtPlan,
      });
      plan = { plan_json: builtPlan };
      console.log('PLATFORM EXECUTION PLAN BUILT', { companyId, campaignId, weekNumber });
    }

    const approvedAssets = await listAssetsWithLatestContent({
      campaignId,
      weekNumber: Number(weekNumber),
      status: 'approved',
    });
    const assetMetadata = new Map<string, any>();
    const assetVariants = new Map<string, any>();
    const complianceReports = new Map<string, any>();
    for (const asset of approvedAssets) {
      const key = `${asset.day}-${asset.platform}`;
      const metadata = await getPromotionMetadata(asset.asset_id, asset.platform);
      const variant = await getPlatformVariant(asset.asset_id, asset.platform);
      const compliance = await getComplianceReport(asset.asset_id, asset.platform);
      if (metadata) assetMetadata.set(key, metadata);
      if (variant) assetVariants.set(key, variant);
      if (compliance) complianceReports.set(key, compliance);
    }

    const blockedCompliance = Array.from(complianceReports.values()).some(
      (report) => report.status === 'blocked' || report.status === 'block'
    );
    if (blockedCompliance) {
      return res.status(400).json({ error: 'Compliance blocked for one or more assets' });
    }

    const payload = buildSchedulerPayload({
      platformExecutionPlan: plan.plan_json,
      approvedAssets,
      assetMetadata,
      assetVariants,
      complianceReports,
    });
    console.log('SCHEDULE GENERATED', { companyId, campaignId, weekNumber });

    await saveSchedulerJobs({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
      jobs: payload.jobs,
    });
    console.log('AUTOMATION PAYLOAD READY', { jobs: payload.jobs.length });

    const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends: [],
      campaign: campaignVersion?.campaign_snapshot?.campaign ?? {},
      weeklyPlans: campaignVersion?.campaign_snapshot?.weekly_plan ?? [],
      dailyPlans: campaignVersion?.campaign_snapshot?.daily_plan ?? [],
      platformExecutionPlan: plan.plan_json,
      contentAssets,
      complianceReports: Array.from(complianceReports.values()),
      promotionMetadataCount: Array.from(assetMetadata.values()).length,
      omnivyraCoverageScore: 0,
    });

    return res.status(200).json({ payload, healthReport });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to build scheduler payload' });
  }
}
