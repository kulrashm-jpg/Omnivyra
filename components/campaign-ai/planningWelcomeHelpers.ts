import type { RecommendationContext } from './types';

export function isMeaningfulPlanningValue(value: unknown, key?: string): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (key === 'exclusive_campaigns' || key === 'available_content') return true;
    return trimmed.length > 0;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return key === 'exclusive_campaigns' ? true : value.length > 0;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ((key === 'available_content' || key === 'content_capacity') && Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone)) {
      return true;
    }
    return Object.keys(obj).length > 0;
  }
  return false;
}

type HasAnsweredPlanningKeyParams = {
  key: string;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  lastCollectedPlanningContextFromApi?: Record<string, unknown> | null;
  buildCollectedPlanningContextForApi: () => Record<string, unknown> | undefined;
  planningSelectedPlatforms: string[];
  configuredPlatformKeys: string[];
  planningPlatformContentRequests: Record<string, Record<string, string>>;
  hasProvidedExclusiveCampaigns: boolean;
  planningAvailableCountsOverride: Record<string, number> | null;
  planningCapacityCountsOverride: Record<string, number> | null;
};

export function hasAnsweredPlanningKey({
  key,
  prefilledPlanning,
  collectedPlanningContext,
  lastCollectedPlanningContextFromApi,
  buildCollectedPlanningContextForApi,
  planningSelectedPlatforms,
  configuredPlatformKeys,
  planningPlatformContentRequests,
  hasProvidedExclusiveCampaigns,
  planningAvailableCountsOverride,
  planningCapacityCountsOverride,
}: HasAnsweredPlanningKeyParams): boolean {
  const pre = prefilledPlanning ?? {};
  const ec = (pre.execution_config as Record<string, unknown> | null | undefined) ?? {};
  const collected = collectedPlanningContext ?? {};
  const apiCollected = lastCollectedPlanningContextFromApi ?? {};
  const fromForm = buildCollectedPlanningContextForApi() ?? {};
  const lookup = (field: string): unknown =>
    fromForm?.[field] ?? apiCollected?.[field] ?? collected?.[field] ?? pre?.[field] ?? ec?.[field];

  if (key === 'platforms') {
    if (planningSelectedPlatforms.length > 0 || configuredPlatformKeys.length > 0) return true;
    const value = lookup('platforms');
    return Array.isArray(value) ? value.length > 0 : isMeaningfulPlanningValue(value, key);
  }
  if (key === 'platform_content_requests') {
    if (planningPlatformContentRequests && Object.keys(planningPlatformContentRequests).length > 0) return true;
    return isMeaningfulPlanningValue(lookup(key), key);
  }
  if (key === 'exclusive_campaigns') {
    if (hasProvidedExclusiveCampaigns) return true;
    return isMeaningfulPlanningValue(lookup(key), key);
  }
  if (key === 'available_content') {
    if (planningAvailableCountsOverride && Object.keys(planningAvailableCountsOverride).length > 0) return true;
    return isMeaningfulPlanningValue(lookup(key), key);
  }
  if (key === 'content_capacity' || key === 'weekly_capacity') {
    if (planningCapacityCountsOverride && Object.keys(planningCapacityCountsOverride).length > 0) return true;
    return isMeaningfulPlanningValue(lookup('content_capacity'), 'content_capacity')
      || isMeaningfulPlanningValue(lookup('weekly_capacity'), 'content_capacity');
  }
  return isMeaningfulPlanningValue(lookup(key), key);
}

export function getFirstQuestion(): string {
  return '**First question:** Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have. (e.g., 3 videos, 10 posts, 2 blogs)';
}

export function getFirstUnansweredGatherKey(hasAnswered: (key: string) => boolean): string | null {
  const gatherKeys = ['available_content', 'content_capacity', 'exclusive_campaigns', 'platforms', 'platform_content_requests'];
  return gatherKeys.find((key) => !hasAnswered(key)) ?? null;
}

type RecommendationWelcomeParams = {
  campaignData: any;
  recommendationContext?: RecommendationContext | null;
  prefilledPlanning?: Record<string, unknown> | null;
  configuredPlatformKeys: string[];
  getFirstUnansweredGatherKey: () => string | null;
  hasAnsweredPlanningKey: (key: string) => boolean;
  getFirstQuestion: () => string;
  onAutoTriggerPlan: () => void;
};

export function buildRecommendationWelcome({
  campaignData,
  recommendationContext,
  prefilledPlanning,
  configuredPlatformKeys,
  getFirstUnansweredGatherKey,
  hasAnsweredPlanningKey,
  getFirstQuestion,
  onAutoTriggerPlan,
}: RecommendationWelcomeParams): string {
  const name = campaignData?.name || 'this campaign';
  const desc = campaignData?.description || campaignData?.objective || '';
  const regions = recommendationContext?.target_regions?.filter(Boolean);
  const payload = recommendationContext?.context_payload as Record<string, unknown> | undefined;
  const formats = payload?.formats as string[] | undefined;
  const reachEst = payload?.reach_estimate;
  const firstMissing = getFirstUnansweredGatherKey();

  if (firstMissing === null) {
    onAutoTriggerPlan();
    const pre = prefilledPlanning ?? {};
    const ec = (pre.execution_config as Record<string, unknown> | null | undefined) ?? {};
    const audience = pre?.target_audience ?? ec.target_audience ?? '';
    const summaryLines: string[] = [];
    if (audience) summaryLines.push(`**Audience:** ${audience}`);
    const summaryBlock = summaryLines.length > 0 ? `\n\n${summaryLines.join('\n')}` : '';
    return [`Hello! I'm ready to build your week plan for **"${name}"**.`, summaryBlock, `\n\nI have all the information I need. Generating your week plan now...`].join('');
  }

  const gatherQuestionMap: Record<string, string> = {
    available_content: 'Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have. (e.g., 3 videos, 10 posts, 2 blogs)',
    content_capacity: 'How many pieces of content can you and your team create every week? (e.g., 3 videos, 10 posts, 2 blogs)',
    exclusive_campaigns: 'Anything only for one platform? (e.g. a LinkedIn-only series, or "no")',
    platforms: 'Where will you post? (e.g. LinkedIn, Instagram, YouTube, X)',
    platform_content_requests: 'How often will you share each content type per platform? (e.g., LinkedIn: 3 posts/week, Instagram: 5 reels/week)',
  };
  const parts: string[] = [`Hello! I'm here to help you turn **"${name}"** into a complete content marketing plan.`];

  if (prefilledPlanning && Object.keys(prefilledPlanning).length > 0) {
    const pre = prefilledPlanning;
    const ec = (pre.execution_config as Record<string, unknown> | null | undefined) ?? {};
    const knownLines: string[] = [];
    const displayFields: Array<[string, string]> = [
      ['target_audience', 'Target audience'],
      ['content_capacity', 'Content capacity'],
      ['platforms', 'Platforms'],
      ['available_content', 'Existing content'],
      ['exclusive_campaigns', 'Platform exclusives'],
      ['platform_content_requests', 'Platform content requests'],
    ];
    for (const [key, label] of displayFields) {
      const v = pre[key] ?? ec[key];
      if (hasAnsweredPlanningKey(key)) {
        const summary =
          typeof v === 'string' ? v
          : key === 'platforms' && configuredPlatformKeys.length > 0 ? configuredPlatformKeys.join(', ')
          : key === 'platform_content_requests' || key === 'available_content' || key === 'content_capacity' ? 'Captured from your earlier setup'
          : Array.isArray(v) ? `${v.length} configured`
          : 'Captured from your earlier setup';
        knownLines.push(`- **${label}:** ${String(summary).slice(0, 100)}`);
      }
    }
    if (knownLines.length > 0) parts.push(`\n\nFrom your setup I already know:\n${knownLines.join('\n')}`);
    if (firstMissing) parts.push(`\n\nI'll only ask for anything still missing.`);
  } else {
    if (desc) parts.push(`\n\nI see your theme: *${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}*`);
    if (regions && regions.length > 0) parts.push(`\n\n**Target regions:** ${regions.join(', ')}`);
    if (formats && formats.length > 0) parts.push(`\n**Suggested formats:** ${formats.join(', ')}`);
    if (reachEst) parts.push(`\n**Estimated reach:** ${reachEst}`);
    parts.push(`\n\nI'll only ask for any missing planning details: available content, content capacity, platform exclusives, platforms, and per-platform content requests. Then say "Create my plan" or "I'm ready".`);
  }

  const questionText = gatherQuestionMap[firstMissing] ?? getFirstQuestion().replace('**First question:** ', '');
  parts.push(`\n\n**${firstMissing === 'available_content' ? 'First' : 'Next'} question:** ${questionText}`);
  return parts.join('');
}

export function buildPrefilledWelcome(
  name: string,
  prefilledPlanning: Record<string, unknown> | null | undefined,
  getFirstUnansweredGatherKey: () => string | null,
  getFirstQuestion: () => string
): string {
  const pre = prefilledPlanning;
  if (!pre || Object.keys(pre).length === 0) return '';
  const items = Object.entries(pre).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
  const firstMissing = getFirstUnansweredGatherKey();
  const questionMap: Record<string, string> = {
    available_content: 'Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have. (e.g., 3 videos, 10 posts, 2 blogs)',
    content_capacity: 'How many pieces of content can you and your team create every week? (e.g., 3 videos, 10 posts, 2 blogs)',
    exclusive_campaigns: 'Anything only for one platform? (e.g. a LinkedIn-only series, or "no")',
    platforms: 'Where will you post? (e.g. LinkedIn, Instagram, YouTube, X)',
    platform_content_requests: 'How often will you share each content type per platform? (e.g., LinkedIn: 3 posts/week, Instagram: 5 reels/week)',
  };
  const firstQuestion = firstMissing
    ? `\n\n**${firstMissing === 'available_content' ? 'First' : 'Next'} question:** ${(questionMap[firstMissing] || getFirstQuestion().replace('**First question:** ', ''))}\n\n`
    : '\n\nI already have everything I need to generate your week plan.\n\n';
  return `Hello! I'm your AI assistant for "${name}".\n\nI already have these from your campaign setup:\n${items}\n\nI'll ask only what's still needed to build your week plan.\n${firstQuestion}`;
}

export function buildGenericWelcome(
  name: string,
  prefilledPlanning: Record<string, unknown> | null | undefined,
  getFirstUnansweredGatherKey: () => string | null,
  getFirstQuestion: () => string
): string {
  const prefilledIntro = buildPrefilledWelcome(name, prefilledPlanning, getFirstUnansweredGatherKey, getFirstQuestion);
  const base = prefilledIntro || `Hello! I'm your AI assistant for "${name}". I'll ask only for any planning details that are still missing.\n\n**Planning checklist:** available content, content capacity, exclusive campaigns, platforms, and platform content requests. Each week will have a concrete theme decided by AI before scheduling.\n\nWhen we have everything, say "Create my plan" or "I'm ready" and I'll generate it.\n\n`;
  return base + (prefilledIntro ? '' : getFirstQuestion());
}
