import { DecisionResult } from './omnivyreClient';
import { DiagnosticsByType } from './viralityAdvisorService';
import { getPlatformStrategies, PlatformStrategy, TrendSignal } from './externalApiService';
import { getHistoricalAccuracyScore } from './performanceFeedbackService';
import { CompanyProfile, normalizeCompanyProfile } from './companyProfileService';
import { logRecommendationAudit } from './recommendationAuditService';
import {
  getActivePolicy,
  RecommendationPolicy,
  RecommendationPolicyWeights,
} from './recommendationPolicyService';

export type Recommendation = {
  recommendation_id?: string;
  title: string;
  description: string;
  trend: string;
  trend_source?: string;
  trend_source_health?: {
    freshness_score: number;
    reliability_score: number;
  };
  category?: string;
  audience?: any;
  geo?: any;
  platforms?: Array<{
    platform: string;
    content_types: string[];
    required_metadata: string[];
  }>;
  promotion_mode: 'organic' | 'paid' | 'mixed';
  effort_score: number;
  expected_reach: number;
  expected_growth: number;
  final_score: number;
  scores: {
    trend_score: number;
    geo_fit_score: number;
    audience_fit_score: number;
    category_fit_score: number;
    source_consensus_score: number;
    health_multiplier: number;
    historical_accuracy_score: number;
    platform_fit_score: number;
    demographic_fit_score: number;
    promotion_fit_score: number;
    effort_score: number;
    final_score: number;
  };
  confidence: number;
  explanation: string;
};

type RecommendationInput = {
  companyProfile: CompanyProfile | null;
  trendSignals: TrendSignal[];
  viralityDiagnostics?: DiagnosticsByType;
  omnivyreDecision?: DecisionResult;
};

const clamp = (value: number, min = 0.1, max = 10) => Math.min(Math.max(value, min), max);

const computeTrendHealthMultiplier = (signals: TrendSignal[]) => {
  if (signals.length === 0) return 1;
  const values = signals.map((signal) => {
    const freshness = signal.trend_source_health?.freshness_score ?? 1;
    const reliability = signal.trend_source_health?.reliability_score ?? 1;
    return clamp(freshness * reliability, 0.1, 2);
  });
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clamp(avg, 0.1, 2);
};

const baseTrendScoreFromSignal = (signal: TrendSignal) => {
  const volume = signal.volume ?? 1;
  const velocity = signal.velocity ?? 1;
  const sentiment = signal.sentiment ?? 0.5;
  return clamp((volume / 1000) * velocity * (0.5 + sentiment));
};

const geoFitScore = (signalGeo?: string | null, geoFocus?: string[]) => {
  if (!signalGeo || !geoFocus || geoFocus.length === 0) return 1;
  const normalized = signalGeo.toLowerCase();
  const matches = geoFocus.some((geo) => normalized.includes(geo));
  return matches ? 1.2 : 0.85;
};

const categoryFitScore = (topic: string, categories: string[]) => {
  if (!topic || categories.length === 0) return 1;
  const normalized = topic.toLowerCase();
  const matches = categories.some((category) => normalized.includes(category));
  return matches ? 1.2 : 0.85;
};

const audienceFitScore = (
  topic: string,
  audience: ReturnType<typeof normalizeCompanyProfile>['target_audience']
) => {
  if (!audience) return 1;
  const normalized = topic.toLowerCase();
  const personaMatch =
    audience.personas?.some((persona) => normalized.includes(persona.toLowerCase())) ?? false;
  const genderMatch =
    (audience.gender && normalized.includes(audience.gender)) ||
    (audience.gender === 'female' && normalized.includes('women')) ||
    (audience.gender === 'male' && normalized.includes('men'));
  const ageMatch =
    audience.age_range && normalized.includes(audience.age_range.replace('-', ' '));

  if (personaMatch || genderMatch || ageMatch) return 1.2;
  return 0.9;
};

const normalizeSource = (source?: string) => {
  if (!source) return 'other';
  const normalized = source.toLowerCase();
  if (normalized.includes('google')) return 'google';
  if (normalized.includes('youtube')) return 'youtube';
  if (normalized.includes('reddit')) return 'reddit';
  if (normalized.includes('news')) return 'news';
  return normalized;
};

const sourceConsensusScore = (sources: string[]) => {
  const uniqueSources = Array.from(new Set(sources.map(normalizeSource)));
  const count = uniqueSources.filter((source) =>
    ['google', 'youtube', 'reddit', 'news'].includes(source)
  ).length;
  const score = 1 + Math.max(0, count - 1) * 0.1;
  return clamp(score, 1, 1.4);
};

const pickMostFrequent = (values: Array<string | undefined | null>) => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => {
    const key = String(value).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let winner = '';
  let max = 0;
  counts.forEach((count, value) => {
    if (count > max) {
      max = count;
      winner = value;
    }
  });
  return winner || undefined;
};

const fuseTrendSignals = (signals: TrendSignal[]) => {
  const groups = new Map<string, { topic: string; signals: TrendSignal[]; firstIndex: number }>();
  signals.forEach((signal, index) => {
    const key = signal.topic.trim().toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { topic: signal.topic.trim(), signals: [signal], firstIndex: index });
    } else {
      existing.signals.push(signal);
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.firstIndex - b.firstIndex);
};

const platformPriorityScore = (platforms?: Array<{ platform: string }>) => {
  if (!platforms || platforms.length === 0) return 1;
  return 1 + Math.min(platforms.length, 3) * 0.05;
};

const resolveEligiblePlatforms = (
  configs: PlatformStrategy[],
  contentType: string,
  promotionMode: Recommendation['promotion_mode']
) => {
  if (configs.length === 0) {
    return [
      {
        platform: 'all',
        content_types: ['*'],
        required_metadata: [],
      },
    ];
  }

  return configs
    .filter((config) => config.is_active)
    .filter((config) => config.health_score >= 0.3)
    .filter((config) => {
      const types = config.supported_content_types || [];
      return types.length === 0 || types.includes(contentType);
    })
    .filter((config) => {
      const modes = config.supported_promotion_modes || [];
      return modes.length === 0 || modes.includes(promotionMode);
    })
    .map((config) => ({
      platform: (config.category || config.name || config.platform_type || '').toLowerCase(),
      content_types: config.supported_content_types,
      required_metadata: config.required_metadata,
    }))
    .filter((config) => config.platform);
};

const promotionFitScore = (mode: Recommendation['promotion_mode']) => {
  if (mode === 'paid') return 0.95;
  if (mode === 'mixed') return 1.05;
  return 1;
};

const estimateEffort = (signals: TrendSignal[]) => {
  const volumeAvg =
    signals.reduce((sum, signal) => sum + (signal.volume ?? 1), 0) / Math.max(signals.length, 1);
  const base = 1 + Math.min(volumeAvg, 5000) / 5000;
  return clamp(base, 1, 5);
};

const computeConfidence = (scores: Recommendation['scores']) => {
  const components = [
    scores.trend_score,
    scores.geo_fit_score,
    scores.audience_fit_score,
    scores.category_fit_score,
    scores.source_consensus_score,
    scores.platform_fit_score,
    scores.health_multiplier,
    scores.historical_accuracy_score,
  ];
  const avg = components.reduce((sum, value) => sum + value, 0) / components.length;
  return Math.round(clamp(avg, 0.1, 2) * 50);
};

const buildExplanation = (
  sources: string[],
  scores: Recommendation['scores']
) => {
  const sourceList = sources.length > 0 ? sources.join(', ') : 'multiple sources';
  return `Trend momentum ${scores.trend_score.toFixed(2)} with consensus ${scores.source_consensus_score.toFixed(
    2
  )}. Geo fit ${scores.geo_fit_score.toFixed(2)}, audience fit ${scores.audience_fit_score.toFixed(
    2
  )}, category fit ${scores.category_fit_score.toFixed(
    2
  )}. Health multiplier ${scores.health_multiplier.toFixed(
    2
  )}, historical accuracy ${scores.historical_accuracy_score.toFixed(
    2
  )} based on ${sourceList}. Final score ${scores.final_score.toFixed(2)}.`;
};

export async function generateRecommendations(
  input: RecommendationInput,
  options?: {
    policyOverride?: RecommendationPolicy;
    policyWeightsOverride?: RecommendationPolicyWeights;
    disableAudit?: boolean;
  }
): Promise<Recommendation[]> {
  const { companyProfile, trendSignals } = input;
  if (!trendSignals || trendSignals.length === 0) return [];

  const platformConfigs = await getPlatformStrategies(companyProfile?.company_id ?? null);
  const fallbackPolicy: RecommendationPolicy = {
    id: 'default',
    name: 'Default Policy',
    is_active: true,
    weights: {
      trend_score: 1,
      geo_fit: 1,
      audience_fit: 1,
      category_fit: 1,
      platform_fit: 1,
      health_multiplier: 1,
      historical_accuracy: 1,
      effort_penalty: 0.1,
    },
  };
  const policyOverride = options?.policyOverride;
  const policyWeightsOverride = options?.policyWeightsOverride;
  const activePolicy =
    policyOverride || policyWeightsOverride ? null : await getActivePolicy();
  const policy: RecommendationPolicy =
    policyOverride ||
    (policyWeightsOverride
      ? {
          ...fallbackPolicy,
          id: 'override',
          name: 'Override Policy',
          is_active: false,
          weights: policyWeightsOverride,
        }
      : activePolicy || fallbackPolicy);
  const contentType = 'text';
  const normalizedProfile = normalizeCompanyProfile(companyProfile);

  return Promise.all(
    fuseTrendSignals(trendSignals)
      .slice(0, 10)
      .map(async (group) => {
      const sources = group.signals.map((signal) => signal.source);
      const consensusScore = sourceConsensusScore(sources);
      const baseTrendScores = group.signals.map((signal) => baseTrendScoreFromSignal(signal));
      const trendScore = clamp(
        (baseTrendScores.reduce((sum, value) => sum + value, 0) / baseTrendScores.length) *
          consensusScore
      );
      const signalGeo = pickMostFrequent(group.signals.map((signal) => signal.geo));
      const geoScore = geoFitScore(signalGeo, normalizedProfile.geo_focus);
      const categoryScore = categoryFitScore(group.topic, normalizedProfile.categories);
      const audienceScore = audienceFitScore(group.topic, normalizedProfile.target_audience);
      const healthMultiplier = computeTrendHealthMultiplier(group.signals);
      const historicalAccuracyScore = await getHistoricalAccuracyScore({
        trend_topic: group.topic,
        company_id: companyProfile?.company_id,
      });
      const historicalAccuracyFactor = 0.8 + 0.4 * historicalAccuracyScore;
      const promotionMode: Recommendation['promotion_mode'] = 'organic';
      const eligiblePlatforms = resolveEligiblePlatforms(platformConfigs, contentType, promotionMode);
      const platformScore = platformPriorityScore(eligiblePlatforms);
      const promotionScore = promotionFitScore(promotionMode);
      const effortScore = estimateEffort(group.signals);

      const finalScore =
        trendScore * policy.weights.trend_score *
        geoScore * policy.weights.geo_fit *
        audienceScore * policy.weights.audience_fit *
        categoryScore * policy.weights.category_fit *
        platformScore * policy.weights.platform_fit *
        healthMultiplier * policy.weights.health_multiplier *
        historicalAccuracyScore * policy.weights.historical_accuracy -
        effortScore * policy.weights.effort_penalty;

      const volumeAvg =
        group.signals.reduce((sum, signal) => sum + (signal.volume ?? 1000), 0) /
        group.signals.length;
      const expectedReach = Math.round(volumeAvg * categoryScore);
      const expectedGrowth = Math.round(expectedReach * 0.1);

      const scores = {
        trend_score: Number(trendScore.toFixed(2)),
        geo_fit_score: Number(geoScore.toFixed(2)),
        audience_fit_score: Number(audienceScore.toFixed(2)),
        category_fit_score: Number(categoryScore.toFixed(2)),
        source_consensus_score: Number(consensusScore.toFixed(2)),
        health_multiplier: Number(healthMultiplier.toFixed(2)),
        historical_accuracy_score: Number(historicalAccuracyScore.toFixed(2)),
        platform_fit_score: Number(platformScore.toFixed(2)),
        demographic_fit_score: Number(audienceScore.toFixed(2)),
        promotion_fit_score: Number(promotionScore.toFixed(2)),
        effort_score: Number(effortScore.toFixed(2)),
        final_score: Number(finalScore.toFixed(2)),
      };

      const recommendation = {
        title: `Ride the ${group.topic} trend`,
        description: `Position content around ${group.topic} for your audience.`,
        trend: group.topic,
        trend_source: Array.from(new Set(sources)).join(' + '),
        trend_source_health: {
          freshness_score: Number(
            (
              group.signals.reduce(
                (sum, signal) => sum + (signal.trend_source_health?.freshness_score ?? 1),
                0
              ) / group.signals.length
            ).toFixed(2)
          ),
          reliability_score: Number(
            (
              group.signals.reduce(
                (sum, signal) => sum + (signal.trend_source_health?.reliability_score ?? 1),
                0
              ) / group.signals.length
            ).toFixed(2)
          ),
        },
        category: group.topic,
        audience: normalizedProfile.target_audience || companyProfile?.target_audience || null,
        geo: signalGeo || companyProfile?.geography || null,
        platforms: eligiblePlatforms,
        promotion_mode: promotionMode,
        effort_score: Number(effortScore.toFixed(2)),
        expected_reach: expectedReach,
        expected_growth: expectedGrowth,
        final_score: Number(finalScore.toFixed(2)),
        scores,
        confidence: computeConfidence(scores),
        explanation: buildExplanation(sources, scores),
        recommendation_id: undefined,
      };

      if (!options?.disableAudit) {
        await logRecommendationAudit({
          campaign_id: null,
          company_id: companyProfile?.company_id ?? null,
          input_snapshot_hash: null,
          trend_sources_used: group.signals.map((signal) => ({
            source: signal.source,
            geo: signal.geo,
            volume: signal.volume,
            velocity: signal.velocity,
            sentiment: signal.sentiment,
            trend_source_health: signal.trend_source_health ?? null,
          })),
          platform_strategies_used: platformConfigs,
          company_profile_used: normalizedProfile,
          scores_breakdown: scores,
          final_score: recommendation.final_score,
          confidence: recommendation.confidence,
          historical_accuracy_factor: Number(historicalAccuracyFactor.toFixed(3)),
          policy_id: policy.id,
          policy_weights_used: policy.weights,
        });
      }

      return recommendation;
    })
  );
}
