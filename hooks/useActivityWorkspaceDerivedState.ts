import { useMemo } from 'react';
import { inferExecutionMode } from '@/lib/shared/executionModeInference';
import {
  CONTENT_TYPE_OPTIONS_BY_PLATFORM,
  VIDEO_CONTENT_TYPES,
  asObject,
  buildMarketingSupport as buildMarketingSupportHelper,
  buildScheduleRowsFromExecutionItem as buildScheduleRowsFromExecutionItemHelper,
  getAddablePlatformsForContentType as getAddablePlatformsForContentTypeHelper,
  getContentTypeOptions as getContentTypeOptionsHelper,
  isVideoContentType as isVideoContentTypeHelper,
  type WorkspacePayload,
} from '@/lib/activity-workspace/shared';
import type { ScheduleItem } from '../types/activityWorkspace';

type Params = {
  payload: WorkspacePayload | null;
  latestMasterContent: Record<string, unknown> | null;
  schedules: ScheduleItem[];
  normalizeKey: (value: unknown) => string;
};

export function useActivityWorkspaceDerivedState({
  payload,
  latestMasterContent,
  schedules,
  normalizeKey,
}: Params) {
  const dailyRaw = asObject(payload?.dailyExecutionItem);
  const nestedBrief = asObject(dailyRaw?.writer_content_brief);
  const nestedIntent = asObject(dailyRaw?.intent);
  const topicText = String((payload?.topic || payload?.title || (dailyRaw?.topicTitle ?? dailyRaw?.topic)) ?? '').trim();
  const writerBrief = nestedBrief || (dailyRaw && (dailyRaw.topicTitle || dailyRaw.writingIntent || dailyRaw.whatShouldReaderLearn || dailyRaw.whatProblemAreWeAddressing || dailyRaw.desiredAction || dailyRaw.narrativeStyle || dailyRaw.introObjective || dailyRaw.summary || dailyRaw.objective || dailyRaw.cta || dailyRaw.brandVoice || dailyRaw.dailyObjective) ? {
    topicTitle: (dailyRaw.topicTitle ?? dailyRaw.topic ?? payload?.title ?? payload?.topic) as string,
    writingIntent: (dailyRaw.writingIntent ?? dailyRaw.description) as string,
    whatShouldReaderLearn: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective) as string,
    whatProblemAreWeAddressing: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary) as string,
    desiredAction: (dailyRaw.desiredAction ?? dailyRaw.cta) as string,
    narrativeStyle: (dailyRaw.narrativeStyle ?? dailyRaw.brandVoice) as string,
    topicGoal: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
  } as Record<string, unknown> : null);
  const intent = nestedIntent || (dailyRaw && (dailyRaw.dailyObjective || dailyRaw.objective || dailyRaw.pain_point || dailyRaw.outcome_promise || dailyRaw.whatProblemAreWeAddressing || dailyRaw.whatShouldReaderLearn || dailyRaw.desiredAction || dailyRaw.cta) ? {
    objective: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
    pain_point: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary ?? dailyRaw.pain_point) as string,
    outcome_promise: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective ?? dailyRaw.outcome_promise) as string,
    cta_type: (dailyRaw.desiredAction ?? dailyRaw.cta ?? dailyRaw.cta_type) as string,
  } as Record<string, unknown> : null);
  const effectiveWhatReaderLearns = String(writerBrief?.whatShouldReaderLearn || '').trim() || (topicText ? `Reader understands ${topicText} and why it matters.` : '-');
  const effectiveProblemAddressed = String(writerBrief?.whatProblemAreWeAddressing || intent?.pain_point || '').trim() || (topicText ? `Uncertainty about ${topicText}` : '-');
  const masterContentFromPayload = asObject(payload?.dailyExecutionItem && asObject(payload.dailyExecutionItem)?.master_content);
  const masterContent = latestMasterContent || masterContentFromPayload;
  const hasMasterGenerated =
    String(masterContent?.generation_status || '').toLowerCase() === 'generated' ||
    String(masterContent?.content || '').trim().length > 0;
  const contentType = String((dailyRaw?.content_type ?? dailyRaw?.contentType ?? 'post') as string).trim().toLowerCase();
  const executionMode = String((dailyRaw?.execution_mode ?? '') as string).trim() || inferExecutionMode(contentType);
  const isCreatorActivity = executionMode === 'CREATOR_REQUIRED' || executionMode === 'CONDITIONAL_AI';
  const creatorCard = asObject((dailyRaw as any)?.creator_card);
  const creatorAsset = asObject(dailyRaw?.creator_asset);
  const hasCreatorAsset = Boolean(
    creatorAsset &&
      (String(creatorAsset.url ?? '').trim() ||
        (Array.isArray(creatorAsset.files) && creatorAsset.files.length > 0) ||
        (creatorAsset.platformUploads && Object.values(creatorAsset.platformUploads as Record<string, { url?: string; externalLink?: string }>).some((upload) => upload?.url?.trim() || upload?.externalLink?.trim())))
  );
  const creatorHasMasterSource = hasCreatorAsset && (
    String(creatorAsset?.description ?? '').trim() ||
    String(creatorAsset?.transcript ?? '').trim() ||
    String(creatorAsset?.theme ?? '').trim() ||
    String(payload?.topic ?? payload?.title ?? '').trim()
  );
  const isDailyTopicView = payload?.source === 'daily';
  const allPlatformOptions = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'reddit', 'pinterest'];
  const suggestedPlatforms = (() => {
    const seen = new Set<string>();
    const add = (platform: unknown) => {
      const normalized = normalizeKey(platform);
      if (normalized && allPlatformOptions.includes(normalized)) seen.add(normalized);
    };
    const daily = asObject(payload?.dailyExecutionItem);
    if (daily) {
      (Array.isArray((daily as any)?.selected_platforms) ? (daily as any).selected_platforms : []).forEach(add);
      (Array.isArray((daily as any)?.planned_platform_targets) ? (daily as any).planned_platform_targets : []).forEach((target: any) => add(target?.platform));
      (Array.isArray((daily as any)?.active_platform_targets) ? (daily as any).active_platform_targets : []).forEach((target: any) => add(target?.platform));
      (Array.isArray((daily as any)?.platform_variants) ? (daily as any).platform_variants : []).forEach((variant: any) => add(variant?.platform));
      add((daily as any)?.platform);
    }
    (payload?.schedules || schedules || []).forEach((schedule: ScheduleItem) => add(schedule.platform));
    const list = Array.from(seen);
    return list.length > 0 ? list : allPlatformOptions;
  })();
  const platformOptions = suggestedPlatforms;
  const contentTypeOptionsByPlatform = CONTENT_TYPE_OPTIONS_BY_PLATFORM;
  const getContentTypeOptionsForPlatform = (platform: string) => getContentTypeOptionsHelper(platform, normalizeKey);
  const isVideoContentTypeForValue = (value: string) => isVideoContentTypeHelper(value, normalizeKey);
  const getAddablePlatformsForType = (value: string) => getAddablePlatformsForContentTypeHelper(value, normalizeKey);
  const allContentTypesForAdd = useMemo(() => {
    const set = new Set<string>();
    Object.values(contentTypeOptionsByPlatform).forEach((options) => options.forEach((item) => set.add(normalizeKey(item))));
    return Array.from(set).sort();
  }, []);
  const labelize = (value: string) =>
    String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  const normalizeComparableText = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const buildScheduleRows = (item: Record<string, unknown>, existingSchedules: ScheduleItem[]) =>
    buildScheduleRowsFromExecutionItemHelper(item, existingSchedules, normalizeKey);
  const buildMarketingSupportForVariant = (
    platform: string,
    variantContentType: string,
    content: string,
    variant?: Record<string, unknown> | null
  ) => buildMarketingSupportHelper({ platform, contentType: variantContentType, content, variant, payload, normalizeKey });

  return {
    allContentTypesForAdd,
    allPlatformOptions,
    buildMarketingSupportForVariant,
    buildScheduleRows,
    contentType,
    contentTypeOptionsByPlatform,
    creatorAsset,
    creatorCard,
    creatorHasMasterSource,
    dailyRaw,
    effectiveProblemAddressed,
    effectiveWhatReaderLearns,
    executionMode,
    getAddablePlatformsForType,
    getContentTypeOptionsForPlatform,
    hasCreatorAsset,
    hasMasterGenerated,
    intent,
    isCreatorActivity,
    isDailyTopicView,
    isVideoContentTypeForValue,
    labelize,
    masterContent,
    masterContentFromPayload,
    nestedBrief,
    nestedIntent,
    normalizeComparableText,
    platformOptions,
    suggestedPlatforms,
    topicText,
    videoContentTypes: VIDEO_CONTENT_TYPES,
    writerBrief,
  };
}


