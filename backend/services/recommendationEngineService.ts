import { getProfile } from './companyProfileService';
import {
  fetchExternalApis,
  getEnabledApis,
  getExternalApiRuntimeSnapshot,
  getPlatformStrategies,
  recordSignalConfidenceSummary,
  TrendSignal,
} from './externalApiService';
import { sendLearningSnapshot } from './omnivyraFeedbackService';
import { getCampaignMemory, validateUniqueness } from './campaignMemoryService';
import {
  getCampaignIntelligence,
  getRecentCampaignIntelligenceForCompany,
  normalizeCampaignTopic,
} from './campaignIntelligenceService';
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
  removeDuplicates,
  scoreByFrequency,
  tagByPlatform,
  TrendSignalNormalized,
} from './trendProcessingService';
import { normalizeTrends } from './trendNormalizationService';
import { supabase } from '../db/supabaseClient';

export type RecommendationEngineInput = {
  companyId: string;
  campaignId?: string | null;
  objective?: string;
  durationWeeks?: number;
  userId?: string | null;
  simulate?: boolean;
  selectedApiIds?: string[] | null;
};

export type PersonaSummary = {
  personas: string[];
  tone?: string | null;
  platform_preferences: string[];
};

export type ScenarioOutcomes = {
  best_case: number;
  worst_case: number;
  likely_case: number;
};

export type ScoringAdjustments = {
  base_confidence: number;
  adjusted_confidence: number;
  persona_fit: number;
  budget_fit: number;
  competitor_gap: number;
};

export type RecommendationEngineResult = {
  trends_used: TrendSignalNormalized[];
  trends_ignored: TrendSignalNormalized[];
  weekly_plan: any[];
  daily_plan: any[];
  confidence_score: number;
  explanation: string;
  sources: string[];
  persona_summary?: PersonaSummary;
  scenario_outcomes?: ScenarioOutcomes;
  scoring_adjustments?: ScoringAdjustments;
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

const normalizeList = (value?: string | null): string[] =>
  String(value || '')
    .split(/[,;/|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizePlatformName = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'twitter' || normalized === 'x') return 'x';
  return normalized;
};

const normalizeObject = (value: any) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const pickObject = (sources: any[], keys: string[]) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = (source as any)[key];
      if (value && typeof value === 'object') {
        return value;
      }
    }
  }
  return {};
};

const extractContentType = (utmContent?: string | null) => {
  if (!utmContent) return null;
  const raw = String(utmContent);
  const [prefix] = raw.split('_');
  return prefix ? prefix.toLowerCase() : null;
};

const loadLearningSignals = async (companyId: string, campaignId: string) => {
  const { data: learningRow } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lookbackWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: clickRows } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('action', 'TRACKING_LINK_CLICK')
    .gte('created_at', lookbackWindow)
    .filter('metadata->>campaign_id', 'eq', campaignId);

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const sources = [performance, metrics];

  const platformClicks: Record<string, number> = {};
  const contentTypeClicks: Record<string, number> = {};
  (clickRows || []).forEach((row: any) => {
    const metadata = row?.metadata || {};
    const platform = String(metadata?.platform || metadata?.utm_source || '').toLowerCase();
    if (platform) {
      platformClicks[platform] = (platformClicks[platform] || 0) + 1;
    }
    const contentType = extractContentType(metadata?.utm_content);
    if (contentType) {
      contentTypeClicks[contentType] = (contentTypeClicks[contentType] || 0) + 1;
    }
  });
  const totalClicks = Object.values(platformClicks).reduce((sum, value) => sum + value, 0);
  const platformAccuracy = Object.entries(platformClicks).reduce<Record<string, any>>(
    (acc, [platform, clicks]) => {
      acc[platform] = {
        clicks,
        share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
      };
      return acc;
    },
    {}
  );
  const contentTypeAccuracy = Object.entries(contentTypeClicks).reduce<Record<string, any>>(
    (acc, [contentType, clicks]) => {
      acc[contentType] = {
        clicks,
        share_pct: totalClicks > 0 ? Number(((clicks / totalClicks) * 100).toFixed(2)) : 0,
      };
      return acc;
    },
    {}
  );

  const momentumAccuracy =
    pickObject(sources, ['momentum_accuracy', 'momentum_insights']) ||
    (typeof enhancementRow?.confidence_score === 'number'
      ? { overall_confidence: enhancementRow.confidence_score }
      : {});

  return {
    platform_accuracy: platformAccuracy,
    content_type_accuracy: contentTypeAccuracy,
    momentum_accuracy: momentumAccuracy,
  };
};

const loadViralTopicMemory = async (campaignId: string) => {
  const { data: learningRow } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const themePerformance =
    metrics.theme_performance ||
    metrics.topic_clusters ||
    performance.theme_performance ||
    performance.topic_clusters ||
    {};
  const themeEntries = Array.isArray(themePerformance)
    ? themePerformance
    : Object.entries(themePerformance).map(([theme, value]) => ({
        theme_name: theme,
        ...((value && typeof value === 'object') ? value : {}),
      }));

  const momentumAccuracy =
    normalizeObject(metrics.momentum_accuracy || performance.momentum_accuracy) ||
    (typeof enhancementRow?.confidence_score === 'number'
      ? { overall_confidence: enhancementRow.confidence_score }
      : {});

  const highPerforming = (themeEntries || [])
    .map((entry: any) => {
      const trend = String(entry.performance_trend || entry.trend || entry.performance || 'stable').toLowerCase();
      const avgEngagement =
        (typeof entry.avg_engagement === 'number' ? entry.avg_engagement : null) ??
        (typeof entry.engagement_rate === 'number' ? entry.engagement_rate : null) ??
        (typeof entry.engagement === 'number' ? entry.engagement : null);
      const repeatSuccessRate =
        (typeof entry.repeat_success_rate === 'number' ? entry.repeat_success_rate : null) ??
        (typeof entry.success_rate === 'number' ? entry.success_rate : null) ??
        (typeof momentumAccuracy?.overall_confidence === 'number'
          ? Math.round(momentumAccuracy.overall_confidence) / 100
          : null);
      const recommendedReuseFrequency = trend === 'down' ? 'Refresh before reuse' : '1-2x per month';
      return {
        theme_name: entry.theme_name || entry.theme || 'Theme',
        avg_engagement: avgEngagement,
        repeat_success_rate: repeatSuccessRate,
        recommended_reuse_frequency: recommendedReuseFrequency,
      };
    })
    .filter((entry: any) => entry && entry.theme_name)
    .slice(0, 6);

  return {
    high_performing_clusters: highPerforming,
  };
};

const loadLeadConversionIntelligence = async (campaignId: string) => {
  const { data: learningRow } = await supabase
    .from('campaign_learnings')
    .select('performance, metrics, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: enhancementRow } = await supabase
    .from('ai_enhancement_logs')
    .select('confidence_score, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const performance = normalizeObject(learningRow?.performance);
  const metrics = normalizeObject(learningRow?.metrics);
  const themePerformance =
    metrics.theme_performance ||
    metrics.topic_clusters ||
    performance.theme_performance ||
    performance.topic_clusters ||
    {};
  const themeEntries = Array.isArray(themePerformance)
    ? themePerformance
    : Object.entries(themePerformance).map(([theme, value]) => ({
        theme_name: theme,
        ...((value && typeof value === 'object') ? value : {}),
      }));

  const highIntent = (themeEntries || [])
    .map((entry: any) => {
      const inboundSignal =
        (typeof entry.inbound_signal_score === 'number' ? entry.inbound_signal_score : null) ??
        (typeof entry.intent_score === 'number' ? entry.intent_score : null) ??
        (typeof entry.conversion_signal === 'number' ? entry.conversion_signal : null);
      const bestPlatforms = Array.isArray(entry.best_platforms) ? entry.best_platforms : [];
      return {
        theme_name: entry.theme_name || entry.theme || 'Theme',
        inbound_signal_score: inboundSignal ?? 0,
        best_platforms: bestPlatforms,
        confidence:
          typeof enhancementRow?.confidence_score === 'number' ? enhancementRow.confidence_score : null,
      };
    })
    .sort((a, b) => (b.inbound_signal_score ?? 0) - (a.inbound_signal_score ?? 0))
    .slice(0, 5);

  return {
    high_intent_themes: highIntent,
  };
};

const extractPersonaSummary = (profile: any): PersonaSummary => {
  const personas = Array.isArray(profile?.target_audience_list)
    ? profile.target_audience_list.map((item: string) => String(item).trim()).filter(Boolean)
    : normalizeList(profile?.target_audience);
  const tone = Array.isArray(profile?.brand_voice_list) && profile.brand_voice_list.length > 0
    ? profile.brand_voice_list[0]
    : profile?.brand_voice ?? null;
  const platform_preferences = Array.isArray(profile?.social_profiles)
    ? profile.social_profiles
        .map((entry: any) => normalizePlatformName(String(entry?.platform || '')))
        .filter(Boolean)
    : [];
  return {
    personas: Array.from(new Set(personas)),
    tone,
    platform_preferences: Array.from(new Set(platform_preferences)),
  };
};

const computePersonaFit = (trends: TrendSignalNormalized[], summary: PersonaSummary): number => {
  if (!summary.personas.length || trends.length === 0) return 1;
  const personaTerms = summary.personas.map((persona) => persona.toLowerCase());
  const matches = trends.filter((trend) =>
    personaTerms.some((term) => trend.topic.toLowerCase().includes(term))
  ).length;
  const ratio = matches / Math.max(1, trends.length);
  return Number((1 + Math.min(0.08, ratio * 0.08)).toFixed(3));
};

const pickBudgetValue = (profile: any): number | null => {
  const candidates = [
    profile?.budget,
    profile?.marketing_budget,
    profile?.monthly_budget,
    profile?.annual_budget,
    profile?.campaign_budget,
  ];
  const found = candidates.find((value) => typeof value === 'number' && Number.isFinite(value));
  return typeof found === 'number' ? found : null;
};

const computeBudgetFit = (profile: any): number => {
  const budget = pickBudgetValue(profile);
  if (budget === null) return 1;
  if (budget <= 0) return 0.95;
  return 1.02;
};

const computeCompetitorGap = (trends: TrendSignalNormalized[], profile: any): number => {
  const competitors = Array.isArray(profile?.competitors_list)
    ? profile.competitors_list.map((item: string) => String(item).trim()).filter(Boolean)
    : normalizeList(profile?.competitors);
  if (competitors.length === 0 || trends.length === 0) return 1;
  const competitorTerms = competitors.map((entry) => entry.toLowerCase());
  const overlap = trends.filter((trend) =>
    competitorTerms.some((term) => trend.topic.toLowerCase().includes(term))
  ).length;
  const overlapRatio = overlap / Math.max(1, trends.length);
  return overlapRatio > 0 ? 0.98 : 1.02;
};

const buildScoringAdjustments = (
  baseConfidence: number,
  trends: TrendSignalNormalized[],
  profile: any,
  summary: PersonaSummary
): ScoringAdjustments => {
  const personaFit = computePersonaFit(trends, summary);
  const budgetFit = computeBudgetFit(profile);
  const competitorGap = computeCompetitorGap(trends, profile);
  const adjusted = Math.round(
    Math.max(0, Math.min(100, baseConfidence * personaFit * budgetFit * competitorGap))
  );
  return {
    base_confidence: baseConfidence,
    adjusted_confidence: adjusted,
    persona_fit: personaFit,
    budget_fit: budgetFit,
    competitor_gap: competitorGap,
  };
};

const applyPersonaPlatformBias = (
  trends: TrendSignalNormalized[],
  summary: PersonaSummary
): TrendSignalNormalized[] => {
  if (!summary.platform_preferences.length || trends.length === 0) return trends;
  const preferenceSet = new Set(summary.platform_preferences.map((value) => value.toLowerCase()));
  const scored = trends.map((trend, index) => {
    const platformTag = String(trend.platform_tag || '').toLowerCase();
    const source = String(trend.source || '').toLowerCase();
    const preferenceMatch =
      (platformTag && preferenceSet.has(platformTag)) ||
      preferenceSet.has(source);
    const confidence = typeof trend.signal_confidence === 'number' ? trend.signal_confidence : 0.6;
    return {
      trend,
      index,
      score: confidence + (preferenceMatch ? 0.15 : 0),
    };
  });
  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.trend);
};

const computeScenarioOutcomes = (confidence: number, trendCount: number): ScenarioOutcomes => {
  const boost = Math.min(15, 5 + trendCount * 2);
  const decline = Math.max(8, Math.round(boost * 0.7));
  return {
    likely_case: confidence,
    best_case: Math.min(100, confidence + boost),
    worst_case: Math.max(0, confidence - decline),
  };
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

const ensureCampaignCompanyLink = async (companyId: string, campaignId?: string | null) => {
  if (!campaignId) return;
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('id')
    .eq('company_id', companyId)
    .eq('campaign_id', campaignId);
  if (error) {
    throw new Error(`Failed to verify campaign link: ${error.message}`);
  }
  if (!data || data.length === 0) {
    const linkError: any = new Error('CAMPAIGN_NOT_IN_COMPANY');
    linkError.code = 'CAMPAIGN_NOT_IN_COMPANY';
    throw linkError;
  }
};

export const generateRecommendations = async (
  input: RecommendationEngineInput,
  options?: {
    onContext?: (context: Record<string, any>) => void;
  }
): Promise<RecommendationEngineResult> => {
  await ensureCampaignCompanyLink(input.companyId, input.campaignId);
  const profile = await getProfile(input.companyId, { autoRefine: true });
  await getCampaignMemory({ companyId: input.companyId, campaignId: input.campaignId ?? undefined });
  const personaSummary = extractPersonaSummary(profile);

  let campaignIntelligence: any | null = null;
  let recentCampaignIntelligence: any[] = [];
  if (input.campaignId) {
    try {
      campaignIntelligence = await getCampaignIntelligence(input.campaignId);
    } catch {
      campaignIntelligence = null;
    }
  }

  if (!campaignIntelligence) {
    try {
      recentCampaignIntelligence = await getRecentCampaignIntelligenceForCompany(
        input.companyId,
        3
      );
    } catch {
      recentCampaignIntelligence = [];
    }
  }

  const recommendationContext = {
    campaign_intelligence: campaignIntelligence,
    recent_campaign_intelligence: recentCampaignIntelligence,
    selected_api_ids: Array.isArray(input.selectedApiIds) ? input.selectedApiIds : null,
  };
  if (input.campaignId) {
    try {
      recommendationContext.learning_signals = await loadLearningSignals(
        input.companyId,
        input.campaignId
      );
    } catch {
      recommendationContext.learning_signals = null;
    }
    try {
      const viralMemory = await loadViralTopicMemory(input.campaignId);
      recommendationContext.high_performing_clusters = viralMemory?.high_performing_clusters ?? null;
    } catch {
      recommendationContext.high_performing_clusters = null;
    }
    try {
      const leadSignals = await loadLeadConversionIntelligence(input.campaignId);
      recommendationContext.high_intent_themes = leadSignals?.high_intent_themes ?? null;
    } catch {
      recommendationContext.high_intent_themes = null;
    }
  }
  void recommendationContext;

  const durationWeeks = input.durationWeeks ?? DEFAULT_DURATION_WEEKS;
  const objective = input.objective ?? 'awareness';
  const platformStrategies = (await getPlatformStrategies(input.companyId)) || [];
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
  let missingEnvPlaceholders: string[] = [];
  try {
    // External APIs are governed by Virality only; this is read-only consumption.
    const externalSummary = await fetchExternalApis(
      input.companyId,
      pickProfileGeo(profile),
      pickProfileCategory(profile),
      {
        recordHealth: true,
        minReliability: 0.3,
        userId: input.userId ?? null,
        selectedApiIds: input.selectedApiIds ?? null,
        feature: 'recommendations',
      }
    );
    const normalizedTrends = normalizeTrends(
      externalSummary.results.map((result) => ({
        source: result.source,
        payload: result.payload,
        health: result.health ?? null,
        geo: pickProfileGeo(profile),
        category: pickProfileCategory(profile),
      }))
    );
    missingEnvPlaceholders = externalSummary.missing_env_placeholders;
    if (missingEnvPlaceholders.length > 0) {
      console.warn('EXTERNAL_API_MISSING_ENV_PLACEHOLDERS', { placeholders: missingEnvPlaceholders });
    }
    console.log('EXTERNAL_API_NORMALIZED_TRENDS', { count: normalizedTrends.length });
    if (typeof recordSignalConfidenceSummary === 'function') {
      recordSignalConfidenceSummary(normalizedTrends.map((trend) => trend.confidence));
    }
    rawSignals = normalizedTrends.map((trend) => ({
      topic: trend.title,
      source: trend.source,
      geo: trend.geo,
      volume: trend.volume,
      sentiment: undefined,
      velocity: undefined,
      signal_confidence: trend.confidence,
      trend_source_health: undefined,
    }));
  } catch (error) {
    console.warn('EXTERNAL_API_FETCH_FAILED');
  }

  const deduped = removeDuplicates(rawSignals);
  const merged = mergeTrendsAcrossSources(deduped);
  const tagged = tagByPlatform(merged);

  if (tagged.length === 0) {
    console.warn('EXTERNAL_API_NO_SIGNALS');
    const fallbackPlan = await generateCampaignStrategy({
      companyId: input.companyId,
      objective,
      durationWeeks,
    });
    const enabledApis = await getEnabledApis(input.companyId);
    const runtimeApiIds =
      Array.isArray(input.selectedApiIds) && input.selectedApiIds.length > 0
        ? input.selectedApiIds
        : enabledApis.map((api) => api.id);
    const signalQuality = await getExternalApiRuntimeSnapshot(runtimeApiIds);
    const healthReport = getOmniVyraHealthReport();
    const lastMeta = getLastMeta();
    if (!isOmniVyraEnabled()) {
      setLastFallbackReason('omnivyra_disabled');
    }
    const baseConfidence = computeConfidence([], undefined);
    const scoringAdjustments = buildScoringAdjustments(baseConfidence, [], profile, personaSummary);
    const scenarioOutcomes = input.simulate
      ? computeScenarioOutcomes(scoringAdjustments.adjusted_confidence, 0)
      : undefined;
    const result = {
      trends_used: [],
      trends_ignored: [],
      weekly_plan: fallbackPlan.weekly_plan ?? [],
      daily_plan: fallbackPlan.daily_plan ?? [],
      confidence_score: scoringAdjustments.adjusted_confidence,
      explanation: buildExplanation({
        trendsUsed: [],
        sources: [],
        fallbackReason: 'No external signals found. Generated a fallback plan.',
      }),
      sources: [],
      persona_summary: personaSummary,
      scoring_adjustments: scoringAdjustments,
      scenario_outcomes: scenarioOutcomes,
      signal_quality: {
        external_api_health_snapshot: signalQuality.health_snapshot,
        cache_hits: signalQuality.cache_stats,
        rate_limited_sources: signalQuality.rate_limited_sources,
        signal_confidence_summary: signalQuality.signal_confidence_summary,
      },
      omnivyra_metadata: {
        placeholders: ['no_external_signals', ...missingEnvPlaceholders],
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
        campaignId: input.campaignId ?? undefined,
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

  const buildTrendReasoning = () => {
    const currentTopics = (campaignIntelligence?.primary_topics || [])
      .map((topic: string) => normalizeCampaignTopic(topic))
      .filter(Boolean) as string[];
    const recentTopics = (recentCampaignIntelligence || []).flatMap((item) =>
      (item?.primary_topics || [])
        .map((topic: string) => normalizeCampaignTopic(topic))
        .filter(Boolean)
    ) as string[];

    const normalizedCurrent = new Set(currentTopics.map((topic) => topic.toLowerCase()));
    const normalizedRecent = new Set(recentTopics.map((topic) => topic.toLowerCase()));

    return trendsUsed.map((trend) => {
      const topic = normalizeCampaignTopic(trend.topic);
      if (!topic) return null;
      const key = topic.toLowerCase();
      const signals: string[] = [];
      if (normalizedCurrent.has(key)) signals.push('topic_overlap_detected');
      if (normalizedRecent.has(key)) signals.push('related_to_recent_campaign');
      if (normalizedRecent.has(key) && !normalizedCurrent.has(key)) {
        signals.push('possible_campaign_continuation');
      }
      if (!normalizedCurrent.has(key) && !normalizedRecent.has(key)) {
        signals.push('novel_theme');
      }
      return {
        topic: trend.topic,
        normalized_topic: topic,
        signals,
      };
    }).filter(Boolean);
  };

  try {
    if (campaignIntelligence || (recentCampaignIntelligence || []).length > 0) {
      recommendationContext.trend_reasoning = buildTrendReasoning();
    }
  } catch {
    // Best-effort only; never block recommendations.
  }
  if (options?.onContext) {
    try {
      options.onContext(recommendationContext);
    } catch {
      // Best-effort only; never block recommendations.
    }
  }

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
    campaignId: input.campaignId ?? undefined,
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

  trendsUsed = applyPersonaPlatformBias(trendsUsed, personaSummary);
  const baseConfidence = computeConfidence(trendsUsed, omnivyraMeta?.confidence);
  const scoringAdjustments = buildScoringAdjustments(
    baseConfidence,
    trendsUsed,
    profile,
    personaSummary
  );
  const confidence = scoringAdjustments.adjusted_confidence;
  const enabledApis = await getEnabledApis(input.companyId);
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
    const fallbackBaseConfidence = computeConfidence([], undefined);
    const fallbackAdjustments = buildScoringAdjustments(
      fallbackBaseConfidence,
      [],
      profile,
      personaSummary
    );
    const scenarioOutcomes = input.simulate
      ? computeScenarioOutcomes(fallbackAdjustments.adjusted_confidence, 0)
      : undefined;
    const result = {
      trends_used: [],
      trends_ignored: [],
      weekly_plan: fallbackPlan.weekly_plan ?? [],
      daily_plan: fallbackPlan.daily_plan ?? [],
      confidence_score: fallbackAdjustments.adjusted_confidence,
      explanation: 'External trend sources unavailable.',
      sources: [],
      persona_summary: personaSummary,
      scoring_adjustments: fallbackAdjustments,
      scenario_outcomes: scenarioOutcomes,
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
        campaignId: input.campaignId ?? undefined,
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
  const scenarioOutcomes = input.simulate
    ? computeScenarioOutcomes(confidence, trendsUsed.length)
    : undefined;
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
    persona_summary: personaSummary,
    scoring_adjustments: scoringAdjustments,
    scenario_outcomes: scenarioOutcomes,
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
      campaignId: input.campaignId ?? undefined,
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

