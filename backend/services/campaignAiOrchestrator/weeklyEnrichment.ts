import { generateCampaignPlan } from '../aiGateway';
import { canonicalJsonStringify } from '../viralitySnapshotBuilder';
import { computeExpectedBaseline, classifyBaseline } from '../baselineClassificationService';
import { getLatestSnapshotsPerPlatform } from '../../db/platformMetricsSnapshotStore';
import type {
  AlignmentEvaluation,
  WeeklyWritingContextInput,
  PlanSkeleton,
  BaselineContextResult,
} from './types';
import {
  buildAlignmentProfile,
  readContextText,
  normalizePlatformKey,
  getPlatformWordLimit,
  ctaToDesiredAction,
  actionExpectationToDesiredAction,
  communicationStyleToTone,
  contentDepthScale,
  platformToPrimaryFormat,
  approximateDepthForTarget,
  parseAlignmentEvaluation,
} from './contentFormatHelpers';
import { sumSkeletonDeliverables, deliverablesToArray } from './planSkeletonHelpers';

export function enrichWeeklyWritingContext(input: WeeklyWritingContextInput): { weeks: any[] } {
  const recommendationPayload = (input.recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const prefilled = (input.prefilledPlanning ?? {}) as Record<string, unknown>;
  const alignmentProfile = buildAlignmentProfile(input.alignment ?? null);

  const globalAudienceProfile =
    readContextText(prefilled, ['audience_professional_segment']) ||
    readContextText(prefilled, ['target_audience']) ||
    readContextText(recommendationPayload, ['target_audience', 'audience', 'ideal_customer_profile', 'icp']) ||
    'Target audience from campaign context';
  const globalPainPoint =
    readContextText(prefilled, ['key_messages']) ||
    readContextText(recommendationPayload, ['problem', 'problem_statement', 'pain_point']) ||
    'Primary audience pain point';
  const globalTransformation =
    readContextText(recommendationPayload, ['desired_transformation', 'transformation']) ||
    readContextText(prefilled, ['theme_or_description']) ||
    'Desired transformation outcome';
  const campaignTheme =
    readContextText(recommendationPayload, ['campaign_theme', 'angle']) ||
    readContextText(prefilled, ['theme_or_description']) ||
    'Campaign theme';
  const toneGuidanceBase =
    communicationStyleToTone(readContextText(prefilled, ['communication_style'])) ||
    readContextText(recommendationPayload, ['tone', 'tone_guidance']) ||
    readContextText(prefilled, ['brand_voice']) ||
    'clear, practical, outcome-driven';
  const desiredActionOverride = actionExpectationToDesiredAction(readContextText(prefilled, ['action_expectation']));
  const depthScale = contentDepthScale(readContextText(prefilled, ['content_depth']));
  const continuity = readContextText(prefilled, ['topic_continuity']);

  const weeks = (input.structured.weeks || []).map((week: any) => {
    const topics = Array.isArray(week?.topics_to_cover)
      ? week.topics_to_cover.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const topicTitles = topics.length > 0 ? topics : [String(week?.theme ?? '').trim() || `Week ${week?.week ?? 1} topic`];
    const allocation = week?.platform_allocation && typeof week.platform_allocation === 'object'
      ? (week.platform_allocation as Record<string, number>)
      : {};
    const sortedPlatforms = Object.entries(allocation)
      .map(([platform, count]) => ({ platform: normalizePlatformKey(platform), count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
    const highestCapacityPlatform = sortedPlatforms[0]?.platform || 'linkedin';
    const baseWordTarget = getPlatformWordLimit(highestCapacityPlatform);
    const maxWordTarget = Math.max(250, Math.min(2400, Math.floor(baseWordTarget * depthScale)));
    const recommendedContentTypes = Array.isArray(week?.content_type_mix)
      ? week.content_type_mix.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : [];
    const weeklyIntent = String(week?.primary_objective ?? week?.objective ?? '').trim() || `Execute week ${week?.week ?? 1} objective.`;
    const weekTheme = String(week?.theme ?? '').trim() || topicTitles[0];
    const successOutcome = String(week?.weekly_kpi_focus ?? '').trim() || 'Reach growth';

    const weeklyContextCapsule = {
      campaignTheme: campaignTheme || weekTheme,
      primaryPainPoint: globalPainPoint,
      desiredTransformation: globalTransformation,
      campaignStage: String(input.campaignStage ?? recommendationPayload.campaign_stage ?? week.phase_label ?? '').trim() || 'Campaign execution',
      psychologicalGoal: String(input.psychologicalGoal ?? recommendationPayload.psychological_goal ?? '').trim() || 'Audience progression',
      momentum:
        String(input.momentum ?? recommendationPayload.momentum ?? week.phase_label ?? '').trim() ||
        (continuity ? `Series preference: ${continuity}` : 'Steady progression'),
      audienceProfile: globalAudienceProfile,
      weeklyIntent,
      toneGuidance: `${toneGuidanceBase}; alignment score ${alignmentProfile.score}/100`,
      successOutcome,
    };

    const topicBriefs = topicTitles.map((topicTitle: string) => {
      const topicContext = {
        topicTitle,
        topicGoal: weeklyIntent,
        audienceAngle: globalAudienceProfile,
        painPointFocus: globalPainPoint,
        transformationIntent: globalTransformation,
        messagingAngle: weekTheme,
        expectedOutcome: successOutcome,
        recommendedContentTypes: recommendedContentTypes.length > 0 ? recommendedContentTypes : ['post'],
        platformPriority: sortedPlatforms.map((item) => item.platform),
        writingIntent: `${weeklyIntent} through "${topicTitle}"`,
      };
      const contentTypeGuidance = {
        primaryFormat: platformToPrimaryFormat(highestCapacityPlatform),
        maxWordTarget,
        platformWithHighestLimit: highestCapacityPlatform,
        adaptationRequired: true as const,
      };
      return {
        topicTitle,
        topicContext,
        whoAreWeWritingFor: globalAudienceProfile,
        whatProblemAreWeAddressing: globalPainPoint,
        whatShouldReaderLearn: globalTransformation,
        desiredAction: desiredActionOverride || ctaToDesiredAction(String(week?.cta_type ?? 'None')),
        approximateDepth: approximateDepthForTarget(maxWordTarget),
        narrativeStyle: toneGuidanceBase,
        contentTypeGuidance,
      };
    });

    return {
      ...week,
      weeklyContextCapsule,
      topics: topicBriefs,
    };
  });

  return { ...input.structured, weeks };
}

export function normalizeStructuredPlanForOutput(params: {
  structured: { weeks: any[] };
  planSkeleton?: PlanSkeleton | null;
}): { weeks: any[] } {
  const { structured, planSkeleton } = params;
  const normalizedWeeks = (structured.weeks || []).map((w: any) => {
    const weekNo = Number(w?.week || 0) || 1;
    const existingObjective = String(
      w?.primary_objective ?? w?.objective ?? w?.week_extras?.objective ?? ''
    ).trim();
    const existingTheme = String(w?.theme ?? '').trim();
    const existingTopicFocus = String(w?.topicFocus ?? w?.week_extras?.topic_focus ?? w?.week_extras?.topicFocus ?? '').trim();
    const existingTopics = Array.isArray(w?.topics_to_cover)
      ? w.topics_to_cover.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const hasObjective = existingObjective.length > 0;
    const hasTheme = existingTheme.length > 0;
    const hasTopicFocus = existingTopicFocus.length > 0 || existingTopics.length > 0;
    const allIntelligenceMissing = !hasObjective && !hasTheme && !hasTopicFocus;

    const topicFocus = allIntelligenceMissing
      ? `Week ${weekNo} Topic Placeholder`
      : (existingTheme || existingTopicFocus || existingTopics[0] || '');
    const objective = allIntelligenceMissing
      ? `Execute week ${weekNo} campaign objective.`
      : existingObjective;
    const topics = existingTopics.length > 0
      ? existingTopics
      : (topicFocus ? [topicFocus] : []);
    const deliverables = planSkeleton?.weeklySlots.find((s) => s.weekNumber === weekNo)?.requiredDeliverables ?? {
      videos: 0,
      posts: 0,
      blogs: 0,
      stories: 0,
    };
    const total = sumSkeletonDeliverables(deliverables);
    const allocation = w?.platform_allocation && typeof w.platform_allocation === 'object'
      ? w.platform_allocation
      : { linkedin: total > 0 ? total : 1 };
    const platformHints = Object.keys(allocation);
    const deliverablesList = Array.isArray(w?.week_extras?.deliverables_list)
      ? w.week_extras.deliverables_list
      : deliverablesToArray(deliverables);

    return {
      ...w,
      week: weekNo,
      primary_objective: objective || w?.primary_objective || '',
      theme: topicFocus,
      topics_to_cover: topics,
      platform_allocation: allocation,
      weekNumber: weekNo,
      objective,
      topicFocus,
      deliverables,
      platformHints,
      week_extras: {
        ...(w?.week_extras || {}),
        weekNumber: weekNo,
        objective,
        topic_focus: topicFocus,
        topicFocus,
        deliverables,
        deliverables_list: deliverablesList,
        platform_hints: platformHints,
        platformHints,
      },
    };
  });
  return { ...structured, weeks: normalizedWeeks };
}

export async function evaluateWeeklyAlignment(params: {
  campaignId?: string | null;
  recommendationContext?: import('./types').RecommendationContext | null;
  campaignStage?: string | null;
  psychologicalGoal?: string | null;
  momentum?: string | null;
  normalizedWeeks: any[];
}): Promise<AlignmentEvaluation> {
  const evaluationPrompt = {
    recommendation_context: params.recommendationContext ?? null,
    campaign_stage: params.campaignStage ?? null,
    psychological_goal: params.psychologicalGoal ?? null,
    momentum: params.momentum ?? null,
    weekly_plan: params.normalizedWeeks,
  };

  const completion = await generateCampaignPlan({
    companyId: null,
    campaignId: params.campaignId ?? null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a campaign weekly-alignment evaluator. Evaluate alignment quality only. ' +
          'Do NOT rewrite plan structure, do NOT add/remove weeks, do NOT change deliverable counts.',
      },
      {
        role: 'user',
        content:
          'Evaluate the weekly plan and return JSON only with this shape:\n' +
          '{alignmentScore:number, progressionScore:number, diversityScore:number, platformAlignmentScore:number, psychologicalFitScore:number, issues:string[], suggestedAdjustments:[{weekNumber:number, suggestion:string}]}\n' +
          'Rules:\n' +
          '- Alignment only; suggestions must be intelligence-field adjustments.\n' +
          '- Do NOT propose structural or count changes.\n' +
          `Input:\n${canonicalJsonStringify(evaluationPrompt)}`,
      },
    ],
  });

  return parseAlignmentEvaluation(completion.output || '');
}

export function isQuestionAligned(modelQuestion: string, expectedQuestion: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = normalize(modelQuestion);
  const b = normalize(expectedQuestion);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const bTokens = b.split(' ').filter((t) => t.length >= 4);
  if (!bTokens.length) return false;
  const overlap = bTokens.filter((t) => a.includes(t)).length;
  return overlap >= Math.max(2, Math.floor(bTokens.length / 2));
}

/** Extract campaign_duration (weeks) from conversation when user answered the duration question. Uses most recent answer. */
export function extractDurationFromConversation(history: Array<{ type: string; message: string }>): number | null {
  const qKeywords = ['weeks', 'week', 'how many', 'campaign run', 'duration', '6, 12'];
  let lastFound: number | null = null;
  for (let i = 0; i < (history?.length ?? 0) - 1; i++) {
    const aiMsg = (history[i]?.message ?? '').toLowerCase();
    const userMsg = (history[i + 1]?.message ?? '').trim();
    if (history[i]?.type !== 'ai' || history[i + 1]?.type !== 'user') continue;
    const aiAsksDuration = qKeywords.some((k) => aiMsg.includes(k));
    if (!aiAsksDuration || !userMsg) continue;
    const match = userMsg.match(/\b(\d{1,2})\s*(?:week|weeks)?\b/i) ?? userMsg.match(/\b(\d{1,2})\b/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 52) lastFound = n;
    }
  }
  return lastFound;
}

/** Campaign type → preferred platform (normalized) for dominant platform selection */
export const PRIMARY_TYPE_PLATFORM_PREFERENCE: Record<string, string[]> = {
  lead_generation: ['linkedin'],
  authority_positioning: ['linkedin'],
  network_expansion: ['linkedin', 'facebook'],
  engagement_growth: ['instagram', 'tiktok'],
  product_promotion: ['instagram', 'linkedin'],
  brand_awareness: [], // broad; use first available or highest
};

export async function resolveBaselineContext(input: {
  companyId: string;
  companyStage: string | null;
  marketScope: string | null;
  baselineOverride: Record<string, unknown> | null;
  primaryType: string;
  platformStrategies: { name: string }[];
}): Promise<BaselineContextResult> {
  const stage = input.companyStage ?? 'early_stage';
  const scope = input.marketScope ?? 'niche';
  const expectedBaseline = computeExpectedBaseline(stage, scope);

  if (input.baselineOverride && typeof input.baselineOverride === 'object') {
    const override = input.baselineOverride as { platform?: string; followers?: number };
    const actualFollowers = Math.max(0, Number(override.followers) ?? 0);
    const platform = String(override.platform || 'unknown');
    const classification = classifyBaseline(actualFollowers, expectedBaseline);
    return {
      stage,
      scope,
      expectedBaseline,
      actualFollowers,
      ratio: classification.ratio,
      status: classification.status,
      primaryPlatform: platform,
    };
  }

  const snapshots = await getLatestSnapshotsPerPlatform(input.companyId);
  if (snapshots.length === 0) {
    return { unavailable: true };
  }

  const pref = PRIMARY_TYPE_PLATFORM_PREFERENCE[input.primaryType] ?? [];
  const byPlatform = new Map(snapshots.map((s) => [s.platform.toLowerCase(), s]));
  const alias = (p: string) => (p === 'x' ? 'twitter' : p);
  const strategyNames = (input.platformStrategies || []).map((p) => {
    const n = String(p.name || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^\s+|\s+$/g, '');
    return alias(n);
  });

  let chosen: { platform: string; followers: number } | null = null;
  for (const p of pref) {
    const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
    if (snap) {
      chosen = { platform: snap.platform, followers: snap.followers };
      break;
    }
  }
  if (!chosen) {
    for (const p of strategyNames) {
      const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
      if (snap) {
        chosen = { platform: snap.platform, followers: snap.followers };
        break;
      }
    }
  }
  if (!chosen) {
    const highest = snapshots.reduce((a, b) => (a.followers >= b.followers ? a : b));
    chosen = { platform: highest.platform, followers: highest.followers };
  }

  const classification = classifyBaseline(chosen.followers, expectedBaseline);
  return {
    stage,
    scope,
    expectedBaseline,
    actualFollowers: chosen.followers,
    ratio: classification.ratio,
    status: classification.status,
    primaryPlatform: chosen.platform,
  };
}
