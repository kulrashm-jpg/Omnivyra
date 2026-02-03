import { TrendSignal, fetchTrendsFromApis } from '../externalApiService';
import { CompanyProfile } from '../companyProfileService';
import { DailyPlan, WeeklyPlan } from '../campaignRecommendationService';

export type TrendItem = {
  topic: string;
  platform: string;
  geography?: string;
  growth_rate?: number;
  velocity?: number;
  sentiment?: number;
  content_type_hint?: string;
  timestamp: string;
};

export type TrendAssessment = {
  trend: TrendItem;
  relevance_score: number;
  novelty_score: number;
  status: 'already_aligned' | 'emerging_opportunity' | 'ignore';
};

const normalizePlatform = (value: string): string => {
  const lower = value.trim().toLowerCase();
  if (lower.includes('youtube')) return 'youtube';
  if (lower.includes('reddit')) return 'reddit';
  if (lower.includes('twitter') || lower.includes('x')) return 'x';
  if (lower.includes('linkedin')) return 'linkedin';
  if (lower.includes('instagram')) return 'instagram';
  if (lower.includes('tiktok')) return 'tiktok';
  if (lower.includes('facebook')) return 'facebook';
  return lower;
};

const toTrendItem = (signal: TrendSignal): TrendItem => ({
  topic: signal.topic,
  platform: normalizePlatform(signal.source),
  geography: signal.geo,
  growth_rate: signal.velocity ?? signal.volume,
  velocity: signal.velocity,
  sentiment: signal.sentiment,
  content_type_hint: undefined,
  timestamp: new Date().toISOString(),
});

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const buildProfileKeywords = (profile: CompanyProfile): string[] => {
  const list = [
    ...(profile.content_themes_list || []),
    ...(profile.industry_list || []),
    ...(profile.goals_list || []),
    profile.content_themes,
    profile.industry,
    profile.goals,
  ]
    .filter(Boolean)
    .map((value) => value!.trim());
  const tokens = list.flatMap((value) => tokenize(value));
  return Array.from(new Set(tokens));
};

const computeRelevance = (trend: TrendItem, keywords: string[]): number => {
  if (keywords.length === 0) return 0;
  const trendTokens = tokenize(trend.topic);
  if (trendTokens.length === 0) return 0;
  const matches = trendTokens.filter((token) => keywords.includes(token)).length;
  return Number((matches / trendTokens.length).toFixed(3));
};

const computeNovelty = (trend: TrendItem, weeklyThemes: string[]): number => {
  if (weeklyThemes.length === 0) return 1;
  const trendTokens = tokenize(trend.topic);
  const themeTokens = weeklyThemes.flatMap((theme) => tokenize(theme));
  const overlap = trendTokens.filter((token) => themeTokens.includes(token)).length;
  if (overlap === 0) return 1;
  return Number((1 - overlap / trendTokens.length).toFixed(3));
};

const assessTrend = (
  trend: TrendItem,
  keywords: string[],
  weeklyThemes: string[]
): TrendAssessment => {
  const relevance = computeRelevance(trend, keywords);
  const novelty = computeNovelty(trend, weeklyThemes);
  if (relevance >= 0.3 && novelty >= 0.5) {
    return { trend, relevance_score: relevance, novelty_score: novelty, status: 'emerging_opportunity' };
  }
  if (relevance >= 0.3) {
    return { trend, relevance_score: relevance, novelty_score: novelty, status: 'already_aligned' };
  }
  return { trend, relevance_score: relevance, novelty_score: novelty, status: 'ignore' };
};

export const buildTrendAssessments = async (input: {
  profile: CompanyProfile;
  weekly_plan: WeeklyPlan;
}): Promise<TrendAssessment[]> => {
  let trendSignals: TrendSignal[] = [];
  try {
    const geoHint = input.profile.geography_list?.[0] ?? input.profile.geography ?? undefined;
    trendSignals = await fetchTrendsFromApis(
      input.profile.company_id,
      geoHint,
      undefined,
      { recordHealth: false }
    );
  } catch {
    trendSignals = [];
  }

  const trendItems = trendSignals.map(toTrendItem);
  const keywords = buildProfileKeywords(input.profile);
  const weeklyThemes = input.weekly_plan.map((week) => week.theme);
  return trendItems.map((trend) => assessTrend(trend, keywords, weeklyThemes));
};

export const alignTrendsToPlans = async (input: {
  profile: CompanyProfile;
  weekly_plan: WeeklyPlan;
  daily_plan: DailyPlan;
  trendAssessments?: TrendAssessment[];
}): Promise<{ weekly_plan: WeeklyPlan; daily_plan: DailyPlan }> => {
  const assessments =
    input.trendAssessments ?? (await buildTrendAssessments(input));

  const relevantTrends = assessments
    .filter((assessment) => assessment.status !== 'ignore')
    .map((assessment) => assessment.trend.topic);

  const uniqueTrends = Array.from(new Set(relevantTrends));
  const weekly_plan = input.weekly_plan.map((week) => ({
    ...week,
    trend_influence: uniqueTrends.filter((trend) =>
      tokenize(trend).some((token) => tokenize(week.theme).includes(token))
    ),
  }));

  const daily_plan = input.daily_plan.map((day) => {
    const weekIndex = weekly_plan.findIndex((week) =>
      day.date.startsWith(`Week ${week.week_number}`)
    );
    const weekTrends = weekIndex >= 0 ? weekly_plan[weekIndex].trend_influence : [];
    return {
      ...day,
      trend_alignment: weekTrends.length > 0,
    };
  });

  return { weekly_plan, daily_plan };
};

export const getTrendAlerts = (
  assessments: TrendAssessment[]
): { emerging_trends: TrendItem[]; status: 'show' | 'silent' } => {
  const emerging = assessments
    .filter((assessment) => assessment.status === 'emerging_opportunity')
    .map((assessment) => assessment.trend);
  return {
    emerging_trends: emerging,
    status: emerging.length > 0 ? 'show' : 'silent',
  };
};
