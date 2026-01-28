import type { NextApiRequest, NextApiResponse } from 'next';
import { generateCampaignStrategy } from '../../../backend/services/campaignRecommendationService';
import {
  saveCampaignVersion,
  saveTrendSnapshot,
  saveWeekVersions,
} from '../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      campaignId,
      campaignObjective,
      durationWeeks,
      contentCapabilities,
      platformRules,
      resourceConstraints,
    } = req.body || {};
    const result = await generateCampaignStrategy({
      companyId,
      objective: campaignObjective,
      durationWeeks,
      contentCapabilities,
      platformRules,
      resourceConstraints,
    });

    if (result.status === 'ready' && result.campaign && companyId) {
      await saveCampaignVersion({
        companyId,
        campaignId,
        campaignSnapshot: {
          campaign: result.campaign,
          weekly_plan: result.weekly_plan,
          daily_plan: result.daily_plan,
          trend_alerts: result.trend_alerts,
          schedule_hints: result.schedule_hints,
          omnivyra: result.omnivyra,
        },
        status: result.campaign.status,
        version: 1,
      });

      if (result.weekly_plan) {
        await saveWeekVersions({ companyId, campaignId, weeks: result.weekly_plan });
      }

      if (result.trend_alerts) {
        await saveTrendSnapshot({ companyId, campaignId, snapshot: result.trend_alerts });
      }
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to validate company profile' });
  }
}
