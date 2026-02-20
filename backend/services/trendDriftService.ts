import { CompanyProfile } from './companyProfileService';

export type TrendDriftResult = {
  driftDetected: boolean;
  newTopics: string[];
  suggestedAction: string;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

const buildThemeTokens = (profile: CompanyProfile): Set<string> => {
  const values = [
    ...(profile.content_themes_list || []),
    ...(profile.industry_list || []),
    ...(profile.goals_list || []),
    profile.content_themes,
    profile.industry,
    profile.goals,
    profile.campaign_focus,
  ].filter(Boolean) as string[];
  return new Set(values.flatMap((value) => tokenize(value)));
};

const getTopicTokens = (topics: string[]) => new Set(topics.flatMap((topic) => tokenize(topic)));

export function detectTrendDrift(input: {
  companyProfile: CompanyProfile;
  previousTrends: string[];
  newTrends: string[];
  analytics?: {
    trendSuccess?: Array<{ trend: string; score: number }>;
  };
}): TrendDriftResult {
  const themeTokens = buildThemeTokens(input.companyProfile);
  const previousTokens = getTopicTokens(input.previousTrends);
  const newTokens = getTopicTokens(input.newTrends);

  const avoidTrends = (input.analytics?.trendSuccess || [])
    .filter((trend) => trend.score < 0.2)
    .map((trend) => trend.trend.toLowerCase());
  const newTopics = Array.from(newTokens).filter((token) => !previousTokens.has(token));
  const relevantNewTopics = newTopics
    .filter((token) => themeTokens.has(token))
    .filter((token) => !avoidTrends.some((avoid) => avoid.includes(token)));

  const driftDetected = relevantNewTopics.length >= 2;
  return {
    driftDetected,
    newTopics: relevantNewTopics,
    suggestedAction: driftDetected
      ? 'Review new trend topics for potential weekly plan adjustments.'
      : 'No material drift detected.',
  };
}
