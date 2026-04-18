import {
  actionExpectationToDesiredAction,
  approximateDepthForTarget,
  communicationStyleToTone,
  contentDepthScale,
  ctaToDesiredAction,
  getPlatformWordLimit,
  normalizePlatformKey,
  platformToPrimaryFormat,
  readContextText,
} from './weeklyWritingHelpers';
import { deliverablesToArray, sumSkeletonDeliverables } from './planSkeletonHelpers';
import type { WeeklyWritingContextInput } from './types';
import type { PlanSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';
import { buildAlignmentProfile } from '../campaign-ai/campaignAiAlignmentHelpers';

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
