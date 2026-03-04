import { z } from 'zod';
import { CompanyProfile, getProfile } from './companyProfileService';
import { WeeklyPlan } from './campaignRecommendationService';
import {
  saveCampaignVersion,
  saveOptimizationHistory,
  saveWeekVersions,
} from '../db/campaignVersionStore';
import { saveCampaignBlueprintFromRecommendation } from '../db/campaignPlanStore';
import { getLatestApprovedCampaignVersion } from '../db/campaignApprovedVersionStore';
import { fromRecommendationPlan, blueprintWeekToLegacyWeekPlan } from './campaignBlueprintAdapter';

type WeekPlanItem = WeeklyPlan[number];

const optimizedWeekSchema = z.object({
  optimized_week_plan: z
    .object({
      theme: z.string().optional(),
      trend_influence: z.array(z.string()).optional(),
      platforms: z.array(z.string()).optional(),
      content_types: z.record(z.array(z.string())).optional(),
      frequency_per_platform: z.record(z.number()).optional(),
      existing_content_used: z.array(z.string()).optional(),
      new_content_needed: z.array(z.string()).optional(),
    })
    .partial(),
  change_summary: z.string(),
  confidence: z.number(),
});

const clampConfidence = (value: number): number => {
  if (Number.isNaN(value)) return 0;
  if (value > 100) return 100;
  if (value < 0) return 0;
  return Math.round(value);
};

import { optimizeWeek } from './aiGateway';

export async function optimizeWeekPlan(input: {
  companyId?: string | null;
  campaignId?: string | null;
  profile: CompanyProfile;
  campaign_objective: string;
  week_plan: WeekPlanItem;
  trend_data: Array<{ topic: string; platform: string; geography?: string }>;
  platform_rules?: Record<string, any>;
}): Promise<{
  optimized_week_plan: WeekPlanItem;
  change_summary: string;
  confidence: number;
}> {
  const systemPrompt =
    'You are a campaign optimization assistant. Return JSON only. No prose.';
  const userPrompt = `
Optimize the weekly plan based on company profile, objective, trends, and platform rules.
Return JSON with:
{
  "optimized_week_plan": {
    "theme": string,
    "trend_influence": string[],
    "platforms": string[],
    "content_types": { [platform: string]: string[] },
    "frequency_per_platform": { [platform: string]: number },
    "existing_content_used": string[],
    "new_content_needed": string[]
  },
  "change_summary": string,
  "confidence": number
}
Use only provided context. Do not invent brand facts.

Company Profile:
${JSON.stringify(input.profile, null, 2)}

Campaign Objective:
${input.campaign_objective}

Week Plan:
${JSON.stringify(input.week_plan, null, 2)}

Trend Data:
${JSON.stringify(input.trend_data, null, 2)}

Platform Rules:
${JSON.stringify(input.platform_rules ?? {}, null, 2)}
`;

  const completion = await optimizeWeek({
    companyId: input.companyId ?? null,
    campaignId: input.campaignId ?? null,
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const parsed = optimizedWeekSchema.parse(completion.output || {});
  const confidence = clampConfidence(parsed.confidence);

  const optimized_week_plan: WeekPlanItem = {
    ...input.week_plan,
    ...parsed.optimized_week_plan,
    ai_optimized: true,
    version: (input.week_plan.version ?? 1) + 1,
  };

  return {
    optimized_week_plan,
    change_summary: parsed.change_summary,
    confidence,
  };
}

export async function optimizeCampaignWeek(input: {
  companyId: string;
  campaignId?: string;
  weekNumber: number;
  reason?: string;
  campaignObjective: string;
  trendData: Array<{ topic: string; platform: string; geography?: string }>;
  platformRules?: Record<string, any>;
  analyticsInsights?: {
    recommendations?: Array<{ type: string; message: string; confidence: number }>;
    rulesToApply?: {
      preferredPlatforms?: string[];
      preferredTimes?: string[];
      avoidTrends?: string[];
      boostContentTypes?: string[];
    };
  };
  /** When campaign_snapshot.weekly_plan is missing, use this (e.g. from unified blueprint) */
  resolvedWeeklyPlan?: any[];
}): Promise<{
  updated_week: WeekPlanItem;
  change_summary: string;
  confidence: number;
}> {
  const profile = await getProfile(input.companyId, { autoRefine: false });
  if (!profile) {
    throw new Error('Company profile not found');
  }

  const campaignVersion = await getLatestApprovedCampaignVersion(input.companyId, input.campaignId);
  if (!campaignVersion?.campaign_snapshot) {
    throw new Error('Campaign not found');
  }

  const snapshotWeeklyPlan = campaignVersion.campaign_snapshot.weekly_plan;
  const weeklyPlan: WeeklyPlan = Array.isArray(snapshotWeeklyPlan) && snapshotWeeklyPlan.length > 0
    ? snapshotWeeklyPlan
    : (input.resolvedWeeklyPlan ?? []);
  if (!weeklyPlan.length) {
    throw new Error('Weekly plan not found');
  }
  const targetWeek = weeklyPlan.find((week) => week.week_number === input.weekNumber);
  if (!targetWeek) {
    throw new Error('Week plan not found');
  }

  const proposal = await optimizeWeekPlan({
    companyId: input.companyId,
    campaignId: input.campaignId ?? null,
    profile,
    campaign_objective: input.campaignObjective,
    week_plan: targetWeek,
    trend_data: input.trendData,
    platform_rules: {
      ...(input.platformRules || {}),
      analytics_insights: input.analyticsInsights || null,
    },
  });

  const updatedWeek = proposal.optimized_week_plan;
  const updatedWeeklyPlan = weeklyPlan.map((week) =>
    week.week_number === input.weekNumber ? updatedWeek : week
  );

  const blueprint = fromRecommendationPlan(updatedWeeklyPlan, input.campaignId ?? '');
  const derivedWeeklyPlan = blueprint.weeks.map((w) => blueprintWeekToLegacyWeekPlan(w));

  if (blueprint.weeks.length > 0) {
    await saveCampaignBlueprintFromRecommendation({
      campaignId: input.campaignId ?? '',
      companyId: input.companyId,
      blueprint,
    });
  }

  console.log('OPTIMIZATION APPLIED', {
    companyId: input.companyId,
    campaignId: input.campaignId,
    weekNumber: input.weekNumber,
    reason: input.reason,
  });

  await saveOptimizationHistory({
    companyId: input.companyId,
    campaignId: input.campaignId,
    weekNumber: input.weekNumber,
    proposal: {
      reason: input.reason,
      ...proposal,
    },
    status: 'proposal',
  });

  await saveWeekVersions({
    companyId: input.companyId,
    campaignId: input.campaignId,
    weeks: [updatedWeek],
  });

  await saveCampaignVersion({
    companyId: input.companyId,
    campaignId: input.campaignId,
    campaignSnapshot: {
      ...campaignVersion.campaign_snapshot,
      weekly_plan: derivedWeeklyPlan,
    },
    status: 'proposed',
    version: (campaignVersion.version ?? 1) + 1,
  });
  console.debug('Campaign strategy version created with status=proposed (blueprint-derived)');

  return {
    updated_week: updatedWeek,
    change_summary: proposal.change_summary,
    confidence: proposal.confidence,
  };
}
