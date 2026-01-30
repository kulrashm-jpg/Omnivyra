import { getProfile } from './companyProfileService';
import {
  fetchTrendsFromApis,
  getEnabledApis,
  getExternalApiRuntimeSnapshot,
  getPlatformStrategies,
  TrendSignal,
} from './externalApiService';
import { sendLearningSnapshot } from './omnivyraFeedbackService';
import { getCampaignMemory, validateUniqueness } from './campaignMemoryService';
import {
  getTrendRanking,
  getTrendRelevance,
  getOmniVyraHealthReport,
  isOmniVyraEnabled,
  TrendSignalInput,
} from './omnivyraClientV1';
import { getLastFallbackReason, getLastMeta, setLastFallbackReason } from './omnivyraHealthService';
import { generateCampaignStrategy } from './campaignRecommendationService';
import {
  mergeTrendsAcrossSources,
  normalizeTrendSignals,
  removeDuplicates,
  scoreByFrequency,
  tagByPlatform,
  TrendSignalNormalized,
} from './trendProcessingService';

export type RecommendationEngineInput = {
  companyId: string;
  campaignId: string;
  objective?: string;
  durationWeeks?: number;
  userId?: string | null;
};

export type RecommendationEngineResult = {
  trends_used: TrendSignalNormalized[];
  trends_ignored: TrendSignalNormalized[];
  weekly_plan: any[];
  daily_plan: any[];
  confidence_score: number;
  explanation: string;
  sources: string[];
  signal_quality?: {
    external_api_health_snapshot: any;
    cache_hits: any;
    rate_limited_sources: string[];
    signal_confidence_summary: { average: number; min: number; max: number } | null;
  };
  omnivyra_metadata?: {
    decision_id?: string;
    confidence?: number;
    explanation?: string;
    placeholders?: string[];
    contract_version?: string;
  };
  omnivyra_learning?: {
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  };
  omnivyra_status?: {
    status: 'healthy' | 'degraded' | 'down' | 'disabled';
    confidence?: number;
    contract_version?: string;
    latency_ms?: number;
    fallback_reason?: string | null;
    last_error?: string | null;
    endpoint?: string | null;
  };
  novelty_score?: number;
};

const DEFAULT_DURATION_WEEKS = 12;

const normalizeTrendInput = (trend: TrendSignalNormalized): TrendSignalInput => ({
  topic: trend.topic,
  source: trend.source,
  geo: trend.geo,
  velocity: trend.velocity,
  sentiment: trend.sentiment,
  volume: trend.volume,
});

const mapByTopic = (trends: TrendSignalNormalized[]) =>
  trends.reduce<Record<string, TrendSignalNormalized>>((acc, trend) => {
    acc[trend.topic.toLowerCase()] = trend;
    return acc;
  }, {});

const pickProfileGeo = (profile: any): string | undefined => {
  const geo = profile?.geography || profile?.geo;
  if (typeof geo === 'string') return geo;
  if (Array.isArray(profile?.geography_list) && profile.geography_list.length > 0) {
    return profile.geography_list[0];
  }
  return undefined;
};

const pickProfileCategory = (profile: any): string | undefined => {
  if (typeof profile?.category === 'string') return profile.category;
  if (Array.isArray(profile?.industry_list) && profile.industry_list.length > 0) {
    return profile.industry_list[0];
  }
  return undefined;
};

const computeConfidence = (
  trendsUsed: TrendSignalNormalized[],
  omniConfidence?: number
): number => {
  if (typeof omniConfidence === 'number') {
    return Math.round(Math.min(100, Math.max(0, omniConfidence * 100)));
  }
  if (trendsUsed.length === 0) return 35;
  return Math.min(90, 50 + trendsUsed.length * 4);
};

const buildExplanation = (input: {
  trendsUsed: TrendSignalNormalized[];
  sources: string[];
  omnivyraExplanation?: string;
  fallbackReason?: string;
}) => {
  if (input.omnivyraExplanation) return input.omnivyraExplanation;
  if (input.fallbackReason) return input.fallbackReason;
  if (input.trendsUsed.length === 0) {
    return 'No external signals were available. A fallback plan was generated.';
  }
  const topTrends = input.trendsUsed.slice(0, 3).map((trend) => trend.topic);
  const sourceList = input.sources.length > 0 ? input.sources.join(', ') : 'multiple sources';
  return `Recommendations built from ${topTrends.join(', ')} using ${sourceList}.`;
};

const applyTrendInfluence = (weeklyPlan: any[], trends: TrendSignalNormalized[]) => {
  const topics = trends.map((trend) => trend.topic);
  return weeklyPlan.map((week: any, index: number) => ({
    ...week,
    trend_influence: week.trend_influence?.length
      ? week.trend_influence
      : topics.slice(index, index + 3),
  }));
};

const toProposalPlan = (weeklyPlan: any[], dailyPlan: any[]) => ({
  themes: weeklyPlan.map((week: any) => week.theme).filter(Boolean),
  topics: dailyPlan.map((day: any) => day.topic).filter(Boolean),
  hooks: dailyPlan.map((day: any) => day.CTA).filter(Boolean),
  messages: weeklyPlan.flatMap((week: any) => week.new_content_needed || []).filter(Boolean),
});

export const generateRecommendations = async (
  input: RecommendationEngineInput
): Promise<RecommendationEngineResult> => {
  const profile = await getProfile(input.companyId, { autoRefine: true });
  await getCampaignMemory({ companyId: input.companyId, campaignId: input.campaignId });

  const durationWeeks = input.durationWeeks ?? DEFAULT_DURATION_WEEKS;
  const objective = input.objective ?? 'awareness';
  const platformStrategies = (await getPlatformStrategies()) || [];
  const platformRules = platformStrategies.reduce<Record<string, { content_types: string[] }>>(
    (acc, strategy) => {
      const key = (strategy.platform_type || strategy.name || '').toLowerCase();
      if (!key) return acc;
      acc[key] = {
        content_types: strategy.supported_content_types || [],
      };
      return acc;
    },
    {}
  );

  let rawSignals: TrendSignal[] = [];
  try {
    rawSignals = await fetchTrendsFromApis(pickProfileGeo(profile), pickProfileCategory(profile), {
      recordHealth: true,
      minReliability: 0.3,
      userId: input.userId ?? null,
    });
  } catch (error) {
    console.warn('EXTERNAL_API_FETCH_FAILED');
  }

  const normalized = normalizeTrendSignals(rawSignals);
  const deduped = removeDuplicates(normalized);
  const merged = mergeTrendsAcrossSources(deduped);
  const tagged = tagByPlatform(merged);

  if (tagged.length === 0) {
    const fallbackPlan = await generateCampaignStrategy({
      companyId: input.companyId,
      objective,
      durationWeeks,
    });
    const enabledApis = await getEnabledApis();
    const signalQuality = await getExternalApiRuntimeSnapshot(enabledApis.map((api) => api.id));
    const healthReport = getOmniVyraHealthReport();
    const lastMeta = getLastMeta();
    if (!isOmniVyraEnabled()) {
      setLastFallbackReason('omnivyra_disabled');
    }
    const result = {
      trends_used: [],
      trends_ignored: [],
      weekly_plan: fallbackPlan.weekly_plan ?? [],
      daily_plan: fallbackPlan.daily_plan ?? [],
      confidence_score: computeConfidence([]),
      explanation: buildExplanation({
        trendsUsed: [],
        sources: [],
        fallbackReason: 'No external signals found. Generated a fallback plan.',
      }),
      sources: [],
      signal_quality: {
        external_api_health_snapshot: signalQuality.health_snapshot,
        cache_hits: signalQuality.cache_stats,
        rate_limited_sources: signalQuality.rate_limited_sources,
        signal_confidence_summary: signalQuality.signal_confidence_summary,
      },
      omnivyra_metadata: {
        placeholders: ['no_external_signals'],
      },
      omnivyra_status: {
        status: healthReport.status,
        confidence: undefined,
        contract_version: lastMeta?.contract_version,
        latency_ms: lastMeta?.latency_ms,
        fallback_reason: getLastFallbackReason() ?? (isOmniVyraEnabled() ? null : 'omnivyra_disabled'),
        last_error: healthReport.last_error,
        endpoint: lastMeta?.endpoint ?? null,
      },
    } as RecommendationEngineResult;

    if (isOmniVyraEnabled()) {
      const learning = await sendLearningSnapshot({
        companyId: input.companyId,
        campaignId: input.campaignId,
        trends_used: [],
        trends_ignored: [],
        signal_confidence_summary: result.signal_quality?.signal_confidence_summary ?? null,
        novelty_score: undefined,
        confidence_score: result.confidence_score,
        placeholders: result.omnivyra_metadata?.placeholders ?? [],
        explanation: result.explanation,
        external_api_health_snapshot: result.signal_quality?.external_api_health_snapshot ?? [],
        timestamp: new Date().toISOString(),
      });
      result.omnivyra_learning = { status: learning.status, error: learning.error };
    } else {
      result.omnivyra_learning = { status: 'skipped' };
    }

    return result;
  }

  let trendsUsed = tagged;
  let trendsIgnored: TrendSignalNormalized[] = [];
  let omnivyraMeta: RecommendationEngineResult['omnivyra_metadata'] = undefined;
  let fallbackReason: string | null = null;

  if (isOmniVyraEnabled()) {
    const relevance = await getTrendRelevance({
      signals: tagged.map(normalizeTrendInput),
      geo: pickProfileGeo(profile),
      category: pickProfileCategory(profile),
      companyProfile: profile,
    });
    if (relevance.status === 'ok') {
      const relevant = relevance.data?.relevant_trends ?? relevance.data?.trends ?? [];
      const ignored = relevance.data?.ignored_trends ?? [];
      const byTopic = mapByTopic(tagged);
      trendsUsed = relevant
        .map((item: any) => byTopic[String(item?.topic || item).toLowerCase()])
        .filter(Boolean);
      trendsIgnored = ignored
        .map((item: any) => byTopic[String(item?.topic || item).toLowerCase()])
        .filter(Boolean);
    } else {
      fallbackReason = (relevance._omnivyra_meta?.error_type || 'omnivyra_unavailable') as string;
      setLastFallbackReason(fallbackReason);
      console.warn('OMNIVYRA_FALLBACK_RELEVANCE', { reason: relevance.error?.message });
    }

    const ranking = await getTrendRanking({
      signals: trendsUsed.map(normalizeTrendInput),
      geo: pickProfileGeo(profile),
      category: pickProfileCategory(profile),
      companyProfile: profile,
    });
    if (ranking.status === 'ok') {
      const ranked = ranking.data?.ranked_trends ?? ranking.data?.trends ?? [];
      const byTopic = mapByTopic(trendsUsed);
      const ordered = ranked
        .map((item: any) => byTopic[String(item?.topic || item).toLowerCase()])
        .filter(Boolean);
      trendsUsed = ordered.length > 0 ? ordered : trendsUsed;
      omnivyraMeta = {
        decision_id: ranking.decision_id,
        confidence: ranking.confidence,
        explanation: ranking.explanation,
        placeholders: ranking.placeholders,
        contract_version: ranking.contract_version,
      };
    } else {
      fallbackReason = (ranking._omnivyra_meta?.error_type || 'omnivyra_unavailable') as string;
      setLastFallbackReason(fallbackReason);
      console.warn('OMNIVYRA_FALLBACK_RANKING', { reason: ranking.error?.message });
    }
  } else {
    trendsUsed = scoreByFrequency(trendsUsed);
    fallbackReason = 'omnivyra_disabled';
    setLastFallbackReason(fallbackReason);
  }

  const sources = Array.from(
    new Set(trendsUsed.flatMap((trend) => trend.sources).filter(Boolean))
  );

  const plan = await generateCampaignStrategy({
    companyId: input.companyId,
    objective,
    durationWeeks,
    platformRules,
  });

  let weeklyPlan = applyTrendInfluence(plan.weekly_plan ?? [], trendsUsed);
  let dailyPlan = plan.daily_plan ?? [];

  const uniqueness = await validateUniqueness({
    companyId: input.companyId,
    campaignId: input.campaignId,
    proposedPlan: toProposalPlan(weeklyPlan, dailyPlan),
  });
  const noveltyScore = uniqueness.similarityScore;

  if (uniqueness.similarityScore > 0.6) {
    console.warn('NOVELTY_WARNING', { companyId: input.companyId, campaignId: input.campaignId });
    const retryPlan = await generateCampaignStrategy({
      companyId: input.companyId,
      objective,
      durationWeeks,
      platformRules,
    });
    weeklyPlan = applyTrendInfluence(retryPlan.weekly_plan ?? weeklyPlan, trendsUsed);
    dailyPlan = retryPlan.daily_plan ?? dailyPlan;
  }

  const confidence = computeConfidence(trendsUsed, omnivyraMeta?.confidence);
  const enabledApis = await getEnabledApis();
  const signalQuality = await getExternalApiRuntimeSnapshot(enabledApis.map((api) => api.id));
  const allUnhealthy =
    signalQuality.health_snapshot.length > 0 &&
    signalQuality.health_snapshot.every((item) => (item.health_score ?? 1) < 0.3);
  if (allUnhealthy) {
    const fallbackPlan = await generateCampaignStrategy({
      companyId: input.companyId,
      objective,
      durationWeeks,
    });
    const healthReport = getOmniVyraHealthReport();
    const lastMeta = getLastMeta();
    if (!isOmniVyraEnabled()) {
      setLastFallbackReason('omnivyra_disabled');
    }
    const result = {
      trends_used: [],
      trends_ignored: [],
      weekly_plan: fallbackPlan.weekly_plan ?? [],
      daily_plan: fallbackPlan.daily_plan ?? [],
      confidence_score: 25,
      explanation: 'External trend sources unavailable.',
      sources: [],
      signal_quality: {
        external_api_health_snapshot: signalQuality.health_snapshot,
        cache_hits: signalQuality.cache_stats,
        rate_limited_sources: signalQuality.rate_limited_sources,
        signal_confidence_summary: signalQuality.signal_confidence_summary,
      },
      omnivyra_metadata: {
        placeholders: ['all_sources_unhealthy'],
      },
      omnivyra_status: {
        status: healthReport.status,
        confidence: undefined,
        contract_version: lastMeta?.contract_version,
        latency_ms: lastMeta?.latency_ms,
        fallback_reason: getLastFallbackReason() ?? (isOmniVyraEnabled() ? null : 'omnivyra_disabled'),
        last_error: healthReport.last_error,
        endpoint: lastMeta?.endpoint ?? null,
      },
    } as RecommendationEngineResult;

    if (isOmniVyraEnabled()) {
      const learning = await sendLearningSnapshot({
        companyId: input.companyId,
        campaignId: input.campaignId,
        trends_used: [],
        trends_ignored: [],
        signal_confidence_summary: result.signal_quality?.signal_confidence_summary ?? null,
        novelty_score: noveltyScore,
        confidence_score: result.confidence_score,
        placeholders: result.omnivyra_metadata?.placeholders ?? [],
        explanation: result.explanation,
        external_api_health_snapshot: result.signal_quality?.external_api_health_snapshot ?? [],
        timestamp: new Date().toISOString(),
      });
      result.omnivyra_learning = { status: learning.status, error: learning.error };
    } else {
      result.omnivyra_learning = { status: 'skipped' };
    }

    return result;
  }

  const healthReport = getOmniVyraHealthReport();
  const lastMeta = getLastMeta();
  const result = {
    trends_used: trendsUsed,
    trends_ignored: trendsIgnored,
    weekly_plan: weeklyPlan,
    daily_plan: dailyPlan,
    confidence_score: confidence,
    explanation: buildExplanation({
      trendsUsed,
      sources,
      omnivyraExplanation: omnivyraMeta?.explanation,
    }),
    sources,
    signal_quality: {
      external_api_health_snapshot: signalQuality.health_snapshot,
      cache_hits: signalQuality.cache_stats,
      rate_limited_sources: signalQuality.rate_limited_sources,
      signal_confidence_summary: signalQuality.signal_confidence_summary,
    },
    omnivyra_metadata: omnivyraMeta,
    omnivyra_status: {
      status: healthReport.status,
      confidence: omnivyraMeta?.confidence,
      contract_version: omnivyraMeta?.contract_version ?? lastMeta?.contract_version,
      latency_ms: lastMeta?.latency_ms,
      fallback_reason: fallbackReason ?? getLastFallbackReason(),
      last_error: healthReport.last_error,
      endpoint: lastMeta?.endpoint ?? null,
    },
    novelty_score: noveltyScore,
  } as RecommendationEngineResult;

  if (isOmniVyraEnabled()) {
    const learning = await sendLearningSnapshot({
      companyId: input.companyId,
      campaignId: input.campaignId,
      trends_used: trendsUsed.map((trend) => ({
        topic: trend.topic,
        source: trend.source,
        signal_confidence: trend.signal_confidence,
      })),
      trends_ignored: trendsIgnored.map((trend) => ({
        topic: trend.topic,
        source: trend.source,
      })),
      signal_confidence_summary: result.signal_quality?.signal_confidence_summary ?? null,
      novelty_score: noveltyScore,
      confidence_score: result.confidence_score,
      placeholders: result.omnivyra_metadata?.placeholders ?? [],
      explanation: result.explanation,
      external_api_health_snapshot: result.signal_quality?.external_api_health_snapshot ?? [],
      timestamp: new Date().toISOString(),
    });
    result.omnivyra_learning = { status: learning.status, error: learning.error };
  } else {
    result.omnivyra_learning = { status: 'skipped' };
  }

  return result;
};

