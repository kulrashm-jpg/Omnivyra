import type { NextApiRequest, NextApiResponse } from 'next';
import { generateCampaignStrategy } from '../../../backend/services/campaignRecommendationService';
import {
  saveCampaignVersion,
  saveTrendSnapshot,
  saveWeekVersions,
} from '../../../backend/db/campaignVersionStore';
import { saveCampaignBlueprintFromRecommendation } from '../../../backend/db/campaignPlanStore';
import {
  fromRecommendationPlan,
  blueprintWeekToLegacyWeekPlan,
} from '../../../backend/services/campaignBlueprintAdapter';
import { validateCapacityAndFrequency } from '../../../backend/services/capacityFrequencyValidationGateway';
import { getCampaignPlanningInputs } from '../../../backend/services/campaignPlanningInputsService';

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
      const rawWeeklyPlan = result.weekly_plan ?? [];
      const blueprint = fromRecommendationPlan(rawWeeklyPlan, campaignId ?? '');
      const derivedWeeklyPlan = blueprint.weeks.map((w) => blueprintWeekToLegacyWeekPlan(w));

      if (blueprint.weeks.length > 0) {
        const planningInputs = await getCampaignPlanningInputs(campaignId ?? '');
        const validationResult = validateCapacityAndFrequency({
          weekly_capacity: planningInputs?.weekly_capacity,
          available_content: planningInputs?.available_content,
          exclusive_campaigns: planningInputs?.exclusive_campaigns,
          cross_platform_sharing: (planningInputs as any)?.cross_platform_sharing,
          blueprint,
        });
        if (
          validationResult &&
          validationResult.status === 'invalid' &&
          !validationResult.override_confirmed
        ) {
          return res.status(400).json({
            error: 'Capacity validation failed',
            validation_result: validationResult,
            result,
          });
        }
        await saveCampaignBlueprintFromRecommendation({
          campaignId: campaignId ?? '',
          companyId,
          blueprint,
        });
      }

      await saveCampaignVersion({
        companyId,
        campaignId,
        campaignSnapshot: {
          campaign: result.campaign,
          weekly_plan: derivedWeeklyPlan,
          daily_plan: result.daily_plan,
          trend_alerts: result.trend_alerts,
          schedule_hints: result.schedule_hints,
          omnivyra: result.omnivyra,
        },
        status: 'proposed',
        version: 1,
      });
      console.debug('Campaign strategy version created with status=proposed (blueprint-first)');

      if (derivedWeeklyPlan.length > 0) {
        await saveWeekVersions({ companyId, campaignId, weeks: derivedWeeklyPlan });
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
