import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import {
  getResolvedCampaignPlanContext,
  PrePlanningRequiredError,
} from '../../../backend/services/campaignBlueprintService';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
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
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber } = req.body || {};
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;
    if (!weekNumber) {
      return res.status(400).json({ error: 'weekNumber is required' });
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
      const resolved = await getResolvedCampaignPlanContext(companyId, campaignId, true);
      if (!resolved) {
        return res.status(404).json({ error: 'Campaign plan not found' });
      }
      const weeklyPlan = resolved.weekly_plan.find(
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
        campaign: resolved.campaign,
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

    const resolvedForHealth = await getResolvedCampaignPlanContext(companyId, campaignId, true);
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends: [],
      campaign: resolvedForHealth?.campaign ?? {},
      weeklyPlans: resolvedForHealth?.weekly_plan ?? [],
      dailyPlans: resolvedForHealth?.daily_plan ?? [],
      expectedDurationWeeks: resolvedForHealth?.duration_weeks,
      platformExecutionPlan: plan.plan_json,
      contentAssets,
      complianceReports: Array.from(complianceReports.values()),
      promotionMetadataCount: Array.from(assetMetadata.values()).length,
      omnivyraCoverageScore: 0,
    });

    return res.status(200).json({ payload, healthReport });
  } catch (error: any) {
    if (error instanceof PrePlanningRequiredError || error?.code === 'PRE_PLANNING_REQUIRED') {
      return res.status(412).json({ code: 'PRE_PLANNING_REQUIRED', message: error?.message });
    }
    return res.status(500).json({ error: error?.message || 'Failed to build scheduler payload' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_PLANNER]);
