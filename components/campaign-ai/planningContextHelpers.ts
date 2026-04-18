import { PLATFORM_LABELS } from '../../backend/constants/platforms';
import { isEligiblePlanningType, prettyContentTypeLabel } from './planningCatalog';
import type { StructuredPlan } from './types';

type BuildCollectedPlanningContextParams = {
  recommendationContext?: { context_payload?: Record<string, unknown> | null } | null;
  structuredPlan: StructuredPlan | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  campaignData?: Record<string, unknown> | null;
  planningAvailableCountsOverride: Record<string, number> | null;
  planningCapacityCountsOverride: Record<string, number> | null;
  configuredPlatformKeys: string[];
  planningPlatformContentTypePrefs: Record<string, string[]>;
  planningSelectedPlatforms: string[];
  quickPlatformContentTypes: Record<string, string[]>;
  hasProvidedPlatformContentRequests: boolean;
  planningPlatformContentRequests: Record<string, Record<string, string>>;
  eligiblePlanningTypes: Set<string>;
  planningCrossPlatformSharingEnabled: boolean;
  planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
  hasProvidedExclusiveCampaigns: boolean;
  planningExclusiveCampaigns: Array<{ platform: string; content_type: string; count_per_week: string }>;
};

export function resolveWorkingDurationWeeks(params: {
  structuredPlan: StructuredPlan | null;
  retrievePlanData: { draftPlan?: { weeks?: unknown[] }; committedPlan?: { weeks?: unknown[] } } | null;
  initialPlan?: { weeks?: unknown[] } | null;
  prefilledPlanning?: { campaign_duration?: number } | null;
  campaignData?: { duration_weeks?: number } | null;
}) {
  const candidates: Array<unknown> = [
    params.structuredPlan?.weeks?.length,
    params.retrievePlanData?.draftPlan?.weeks?.length,
    params.retrievePlanData?.committedPlan?.weeks?.length,
    params.initialPlan?.weeks?.length,
    params.prefilledPlanning?.campaign_duration,
    params.campaignData?.duration_weeks,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 52) {
      return parsed;
    }
  }
  return 12;
}

export function buildCollectedPlanningContextForApi({
  recommendationContext,
  structuredPlan,
  prefilledPlanning,
  collectedPlanningContext,
  campaignData,
  planningAvailableCountsOverride,
  planningCapacityCountsOverride,
  configuredPlatformKeys,
  planningPlatformContentTypePrefs,
  planningSelectedPlatforms,
  quickPlatformContentTypes,
  hasProvidedPlatformContentRequests,
  planningPlatformContentRequests,
  eligiblePlanningTypes,
  planningCrossPlatformSharingEnabled,
  planningCrossPlatformScheduleMode,
  hasProvidedExclusiveCampaigns,
  planningExclusiveCampaigns,
}: BuildCollectedPlanningContextParams): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = {};
  const recPayload = (recommendationContext?.context_payload ?? {}) as Record<string, unknown>;
  const weekOne: any = structuredPlan?.weeks?.[0];
  const weekOneCapsule: any | undefined = weekOne?.weeklyContextCapsule;

  const pickString = (...values: Array<unknown>) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  const normalizePlatformContentType = (label: string): string => {
    const normalized = String(label || '').toLowerCase().trim();
    if (!normalized) return '';
    if (normalized.includes('blog') || normalized.includes('article')) return 'article';
    if (normalized.includes('slide')) return 'slideware';
    if (normalized.includes('carousel')) return 'carousel';
    if (normalized.includes('song') || normalized.includes('audio')) return 'song';
    if (normalized.includes('thread')) return 'thread';
    if (normalized.includes('space')) return 'space';
    if (normalized.includes('short')) return 'short';
    if (normalized.includes('live')) return 'live';
    if (normalized.includes('reel')) return 'reel';
    if (normalized.includes('story')) return 'story';
    if (normalized.includes('video')) return 'video';
    if (normalized.includes('post')) return 'post';
    return normalized.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  };

  const targetAudience = pickString(
    (prefilledPlanning as any)?.target_audience,
    (collectedPlanningContext as any)?.target_audience,
    recPayload.target_audience,
    weekOneCapsule?.audienceProfile
  );
  if (targetAudience) base.target_audience = targetAudience;

  const tentativeStart = pickString(
    (prefilledPlanning as any)?.tentative_start,
    (collectedPlanningContext as any)?.tentative_start,
    (campaignData as any)?.start_date
  );
  if (tentativeStart) base.tentative_start = tentativeStart;

  if (planningAvailableCountsOverride && Object.keys(planningAvailableCountsOverride).length > 0) {
    base.available_content = planningAvailableCountsOverride;
  } else {
    const availableContent = (prefilledPlanning as any)?.available_content ?? (collectedPlanningContext as any)?.available_content;
    if (availableContent != null && (typeof availableContent === 'object' || (typeof availableContent === 'string' && String(availableContent).trim()))) {
      base.available_content = availableContent;
    }
  }

  if (planningCapacityCountsOverride && Object.keys(planningCapacityCountsOverride).length > 0) {
    base.content_capacity = planningCapacityCountsOverride;
    base.weekly_capacity = planningCapacityCountsOverride;
  } else {
    const capacity =
      (prefilledPlanning as any)?.content_capacity ??
      (prefilledPlanning as any)?.weekly_capacity ??
      (collectedPlanningContext as any)?.content_capacity ??
      (collectedPlanningContext as any)?.weekly_capacity;
    if (capacity != null) base.content_capacity = capacity;
    if (capacity != null) base.weekly_capacity = capacity;
  }

  const durationWeeks =
    (prefilledPlanning as any)?.campaign_duration ??
    (collectedPlanningContext as any)?.campaign_duration ??
    structuredPlan?.weeks?.length;
  const durationNum = Number(durationWeeks);
  if (Number.isFinite(durationNum) && durationNum >= 1 && durationNum <= 52) {
    base.campaign_duration = durationNum;
  }

  const platformsFromFields = pickString(
    (prefilledPlanning as any)?.platforms,
    (collectedPlanningContext as any)?.platforms
  );
  const platformsFromWeek =
    weekOne?.platform_allocation && typeof weekOne.platform_allocation === 'object'
      ? Object.keys(weekOne.platform_allocation).join(', ')
      : '';
  const configuredPlatforms = configuredPlatformKeys.length > 0
    ? configuredPlatformKeys.map((platform) => PLATFORM_LABELS[platform] || platform).join(', ')
    : '';
  const platforms = pickString(platformsFromFields, platformsFromWeek, configuredPlatforms);
  if (platforms) base.platforms = platforms;

  const platformContentTypesFromFields =
    (prefilledPlanning as any)?.platform_content_types ?? (collectedPlanningContext as any)?.platform_content_types;
  if (typeof platformContentTypesFromFields === 'string' && platformContentTypesFromFields.trim()) {
    base.platform_content_types = platformContentTypesFromFields.trim();
  } else if (planningPlatformContentTypePrefs && Object.keys(planningPlatformContentTypePrefs).length > 0) {
    base.platform_content_types = JSON.stringify(planningPlatformContentTypePrefs);
  } else {
    const selectedPlatforms = planningSelectedPlatforms.length > 0 ? planningSelectedPlatforms : Object.keys(quickPlatformContentTypes || {});
    const mapping: Record<string, string[]> = {};
    for (const rawPlatform of selectedPlatforms) {
      const raw = quickPlatformContentTypes?.[rawPlatform] ?? [];
      const normalized = Array.from(new Set(raw.map(normalizePlatformContentType).filter(Boolean)));
      if (normalized.length > 0) mapping[rawPlatform] = normalized;
    }
    if (Object.keys(mapping).length > 0) {
      base.platform_content_types = JSON.stringify(mapping);
    }
  }

  const platformContentRequestsFromFields =
    (prefilledPlanning as any)?.platform_content_requests ?? (collectedPlanningContext as any)?.platform_content_requests;
  if (platformContentRequestsFromFields && typeof platformContentRequestsFromFields === 'object') {
    base.platform_content_requests = platformContentRequestsFromFields;
  } else if (hasProvidedPlatformContentRequests && Object.keys(planningPlatformContentRequests).length > 0) {
    const next: Record<string, Record<string, number>> = {};
    for (const [platform, byType] of Object.entries(planningPlatformContentRequests)) {
      const out: Record<string, number> = {};
      for (const [contentType, rawCount] of Object.entries(byType || {})) {
        const label = prettyContentTypeLabel(contentType);
        if (!isEligiblePlanningType(label, eligiblePlanningTypes)) continue;
        const count = Number(String(rawCount).replace(/\D/g, '').slice(0, 2));
        if (Number.isFinite(count) && count > 0) out[String(contentType)] = Math.floor(count);
      }
      if (Object.keys(out).length > 0) next[String(platform)] = out;
    }
    if (Object.keys(next).length > 0) base.platform_content_requests = next;
  }

  if (hasProvidedPlatformContentRequests || base.platform_content_requests) {
    base.cross_platform_sharing = {
      enabled: planningCrossPlatformSharingEnabled,
      schedule: planningCrossPlatformScheduleMode,
    };
  }

  const exclusiveCampaignsFromFields =
    (prefilledPlanning as any)?.exclusive_campaigns ?? (collectedPlanningContext as any)?.exclusive_campaigns;
  if (Array.isArray(exclusiveCampaignsFromFields)) {
    base.exclusive_campaigns = exclusiveCampaignsFromFields;
  } else if (hasProvidedExclusiveCampaigns) {
    const cleaned = planningExclusiveCampaigns
      .map((row) => {
        const platform = String((row as any)?.platform || '').trim().toLowerCase();
        const content_type = String((row as any)?.content_type || '').trim();
        const count = Number(String((row as any)?.count_per_week || '').replace(/\D/g, '').slice(0, 2));
        const count_per_week = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
        if (!platform || !content_type || count_per_week <= 0) return null;
        return { platform, content_type, count_per_week };
      })
      .filter(Boolean);
    base.exclusive_campaigns = cleaned.length > 0 ? cleaned : [];
  }

  const keyMessages = pickString(
    (prefilledPlanning as any)?.key_messages,
    (collectedPlanningContext as any)?.key_messages,
    recPayload.key_messages
  );
  if (keyMessages) base.key_messages = keyMessages;

  return Object.keys(base).length > 0 ? base : undefined;
}
