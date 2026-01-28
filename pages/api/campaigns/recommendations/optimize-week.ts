import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../../backend/services/companyProfileService';
import { optimizeWeekPlan } from '../../../../backend/services/campaignOptimizationService';
import { WeeklyPlan, WeekOptimizationResult } from '../../../../backend/services/campaignRecommendationService';
import { fetchTrendsFromApis } from '../../../../backend/services/externalApiService';
import { saveOptimizationHistory } from '../../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      campaignObjective,
      weekNumber,
      weeklyPlan,
      platformRules,
    } = req.body || {};

    if (!companyId || !weekNumber || !Array.isArray(weeklyPlan)) {
      return res.status(400).json({ error: 'Missing companyId, weekNumber, or weeklyPlan' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const targetWeek = (weeklyPlan as WeeklyPlan).find((week) => week.week_number === weekNumber);
    if (!targetWeek) {
      return res.status(404).json({ error: 'Week plan not found' });
    }

    const geoHint = profile.geography_list?.[0] ?? profile.geography ?? undefined;
    const trendSignals = await fetchTrendsFromApis(geoHint, undefined, { recordHealth: false });
    const trendData = trendSignals.map((signal) => ({
      topic: signal.topic,
      platform: signal.source,
      geography: signal.geo,
    }));

    const proposal = await optimizeWeekPlan({
      profile,
      campaign_objective: campaignObjective ?? 'engagement',
      week_plan: targetWeek,
      trend_data: trendData,
      platform_rules: platformRules,
    });

    const response: WeekOptimizationResult = {
      ...proposal,
      status: 'proposal',
    };

    await saveOptimizationHistory({
      companyId,
      weekNumber,
      proposal: response,
      status: 'proposal',
    });

    return res.status(200).json(response);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to optimize week plan' });
  }
}
