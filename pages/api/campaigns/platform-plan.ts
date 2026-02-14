import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getResolvedCampaignPlanContext } from '../../../backend/services/campaignBlueprintService';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import {
  buildPlatformExecutionPlan,
} from '../../../backend/services/platformIntelligenceService';
import {
  getLatestPlatformExecutionPlan,
  savePlatformExecutionPlan,
} from '../../../backend/db/platformExecutionStore';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber, force } = req.body || {};
    if (!companyId || !weekNumber) {
      return res.status(400).json({ error: 'companyId and weekNumber are required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    if (!force) {
      const cached = await getLatestPlatformExecutionPlan({
        companyId,
        campaignId,
        weekNumber: Number(weekNumber),
      });
      if (cached?.plan_json) {
        return res.status(200).json({ plan: cached.plan_json });
      }
    }

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
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: resolved.campaign,
      weekPlan: weeklyPlan,
      trends,
    });

    console.log('PLATFORM EXECUTION PLAN BUILT', {
      companyId,
      campaignId,
      weekNumber,
    });

    await savePlatformExecutionPlan({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
      planJson: plan,
    });

    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends,
      campaign: resolved.campaign,
      weeklyPlans: resolved.weekly_plan,
      dailyPlans: resolved.daily_plan,
      expectedDurationWeeks: resolved.duration_weeks,
      platformExecutionPlan: plan,
      contentAssets: await listAssetsWithLatestContent({ campaignId }),
    });

    return res.status(200).json({ plan, healthReport });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to build platform plan' });
  }
}
