import { CompanyProfile } from './companyProfileService';

export type PlatformExecutionDay = {
  date: string;
  platform: string;
  contentType: string;
  theme: string;
  placeholder: boolean;
  suggestedTime: string;
  reasoning: string;
  trendUsed?: string | null;
};

export type PlatformExecutionPlan = {
  weekNumber: number;
  days: PlatformExecutionDay[];
  frequencySummary: Record<string, number>;
  omnivyra?: any;
};

const PLATFORM_TIMES: Record<string, string> = {
  linkedin: '09:00',
  instagram: '19:00',
  x: '12:00',
  youtube: '18:00',
  blog: '08:00',
  tiktok: '20:00',
  podcast: '08:00',
};

const PLATFORM_CONTENT_TYPES: Record<string, string[]> = {
  linkedin: ['text', 'image', 'carousel'],
  instagram: ['image', 'carousel', 'video'],
  x: ['text', 'image'],
  youtube: ['video'],
  blog: ['blog', 'text'],
  tiktok: ['video'],
  podcast: ['audio'],
};

const CONTENT_TYPE_LIMITS: Record<string, number> = {
  blog: 2,
  video: 3,
  audio: 2,
  podcast: 2,
};

const normalizePlatform = (platform: string): string => {
  const lower = platform.trim().toLowerCase();
  if (lower === 'twitter') return 'x';
  return lower;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const buildAlignmentTokens = (profile: CompanyProfile, campaign: any): Set<string> => {
  const values = [
    ...(profile.content_themes_list || []),
    ...(profile.target_audience_list || []),
    ...(profile.goals_list || []),
    profile.content_themes,
    profile.target_audience,
    profile.goals,
    campaign?.objective,
  ].filter(Boolean) as string[];
  return new Set(values.flatMap((value) => tokenize(value)));
};

const pickTrend = (trends: string[], tokens: Set<string>): string | null => {
  for (const trend of trends) {
    const trendTokens = tokenize(trend);
    if (trendTokens.some((token) => tokens.has(token))) {
      return trend;
    }
  }
  return null;
};

const selectContentType = (
  platform: string,
  weekContentTypes?: Record<string, string[]>,
  contentTypeCounts?: Record<string, number>
): string => {
  const types = weekContentTypes?.[platform] || PLATFORM_CONTENT_TYPES[platform] || ['text'];
  const counts = contentTypeCounts || {};
  for (const type of types) {
    const limit = CONTENT_TYPE_LIMITS[type];
    if (!limit || (counts[type] ?? 0) < limit) {
      return type;
    }
  }
  return 'text';
};

export function buildPlatformExecutionPlan(input: {
  companyProfile: CompanyProfile;
  campaign: any;
  weekPlan: any;
  trends: string[];
}): PlatformExecutionPlan {
  const weekNumber = input.weekPlan.week_number;
  const platformsRaw = input.weekPlan.platforms || [];
  const platformSet = new Set(platformsRaw.map(normalizePlatform));
  if (platformSet.size < 3) {
    (input.companyProfile.social_profiles || []).forEach((entry) => {
      if (entry?.platform) platformSet.add(normalizePlatform(entry.platform));
    });
  }
  const platforms = Array.from(platformSet).slice(0, 5);
  const frequencySummary: Record<string, number> = {};
  const contentTypeCounts: Record<string, number> = {};
  const alignmentTokens = buildAlignmentTokens(input.companyProfile, input.campaign);
  const trends = [...input.trends];

  const days: PlatformExecutionDay[] = [];
  let previousPlatform = '';
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const platform = platforms[dayIndex % platforms.length];
    const resolvedPlatform = platform === previousPlatform && platforms.length > 1
      ? platforms[(dayIndex + 1) % platforms.length]
      : platform;
    previousPlatform = resolvedPlatform;

    const contentType = selectContentType(
      resolvedPlatform,
      input.weekPlan.content_types,
      contentTypeCounts
    );
    contentTypeCounts[contentType] = (contentTypeCounts[contentType] ?? 0) + 1;
    frequencySummary[resolvedPlatform] = (frequencySummary[resolvedPlatform] ?? 0) + 1;

    const trend = pickTrend(trends, alignmentTokens);
    if (trend) {
      trends.splice(trends.indexOf(trend), 1);
    }

    const placeholder = ['video', 'audio', 'podcast'].includes(contentType);
    const reasoning = placeholder
      ? 'Requires manual production or media generation'
      : trend
      ? 'Trend aligned with campaign themes'
      : 'Aligned with weekly theme and platform mix';

    days.push({
      date: `Week ${weekNumber} Day ${dayIndex + 1}`,
      platform: resolvedPlatform,
      contentType,
      theme: input.weekPlan.theme,
      placeholder,
      suggestedTime: PLATFORM_TIMES[resolvedPlatform] || '10:00',
      reasoning,
      trendUsed: trend ?? null,
    });
  }

  return {
    weekNumber,
    days,
    frequencySummary,
    omnivyra: input.weekPlan?.omnivyra ?? input.campaign?.omnivyra ?? null,
  };
}
