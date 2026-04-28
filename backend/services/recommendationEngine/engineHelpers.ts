import { getProfile } from '../companyProfileService';
import {
  fetchExternalApis,
  getEnabledApis,
  getExternalApiRuntimeSnapshot,
  getPlatformStrategies,
  recordSignalConfidenceSummary,
  TrendSignal,
} from '../externalApiService';
import { sendLearningSnapshot } from '../omnivyraFeedbackService';
import { getCampaignMemory, validateUniqueness } from '../campaignMemoryService';
import {
  getCampaignIntelligence,
  getRecentCampaignIntelligenceForCompany,
  normalizeCampaignTopic,
} from '../campaignIntelligenceService';
import {
  getTrendRanking,
  getTrendRelevance,
  getOmnivyraHealthReport,
  isOmnivyraEnabled,
  TrendSignalInput,
} from '../omnivyraClientV1';
import { getLastFallbackReason, getLastMeta, setLastFallbackReason } from '../omnivyraHealthService';
import { generateCampaignStrategy, type CampaignObjective } from '../campaignRecommendationService';
import {
  mergeTrendsAcrossSources,
  mergeSignalsAcrossRegions,
  removeDuplicates,
  tagByPlatform,
  TrendSignalNormalized,
} from '../trendProcessingService';
import { normalizeTrends } from '../trendNormalizationService';
import { supabase } from '../../db/supabaseClient';
import { deriveDisqualifiedSignals } from '../companyMissionContext';
import { buildCompanyContext } from '../companyContextService';
import { polishRecommendations } from '../recommendationPolishService';
import { enrichRecommendationIntelligence } from '../recommendationIntelligenceService';
import { buildCompanyStrategyDNA } from '../companyStrategyDNAService';
import { analyzeStrategySignals } from '../recommendationStrategyFeedbackService';
import { sequenceRecommendations } from '../recommendationSequencingService';
import { buildCampaignBlueprint } from '../recommendationBlueprintService';
import {
  loadRecentCompanyThemes,
  checkThemeOriginality,
  DEFAULT_ORIGINALITY_THRESHOLD,
} from '../../utils/themeOriginalityGuard';
import { getCompanyPerformanceInsights } from '../campaignLearningService';
import { validateCampaignBlueprint } from '../recommendationBlueprintValidationService';
import {
  resolveExecutionBlueprint,
  EXECUTION_SOURCE_VALIDATED,
} from '../blueprintExecutionResolver';
import { enrichRecommendationCards } from '../recommendationCardEnrichmentService';
import { buildFallbackRecommendationSignals } from '../recommendationFallbackSignalService';

import {
  buildCoreProblemTokens,
  buildWeightedAlignmentTokens,
  computeAlignmentScore,
  extractStrategicPayloadTokensByTier,
  hasOverlapWithTokens,
  scoreByAlignmentThenPopularity,
} from './scoringHelpers';
import type {
  PersonaSummary,
  RecommendationEngineInput,
  RecommendationEngineResult,
  ScenarioOutcomes,
  ScoringAdjustments,
  StrategicPayloadInput,
} from './types';

/** Attach signal_id from intelligence_signals when topics have matching stored signals. */

export async function attachIntelligenceSignalIds(
  companyId: string,
  signals: TrendSignalNormalized[]
): Promise<TrendSignalNormalized[]> {
  if (signals.length === 0) return signals;
  const topicSet = new Set(signals.map((s) => (s.topic ?? '').trim().toLowerCase()).filter(Boolean));
  if (topicSet.size === 0) return signals;
  try {
    const { data: rows } = await supabase
      .from('intelligence_signals')
      .select('id, topic, signal_type')
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('detected_at', { ascending: false })
      .limit(200);
    if (!rows?.length) return signals;
    const byTopic = new Map<string, { id: string; signal_type: string }>();
    for (const r of rows) {
      const key = (r.topic ?? '').trim().toLowerCase();
      if (key && topicSet.has(key) && !byTopic.has(key)) {
        byTopic.set(key, { id: r.id, signal_type: r.signal_type ?? 'trend' });
      }
    }
    return signals.map((s) => {
      const key = (s.topic ?? '').trim().toLowerCase();
      const match = key ? byTopic.get(key) : null;
      if (!match) return s;
      return {
        ...s,
        signal_id: match.id,
        signal_type: s.signal_type ?? 'EXTERNAL_API',
        source_topic: s.source_topic ?? s.topic ?? null,
      };
    });
  } catch {
    return signals;
  }
}

/** Map hierarchical core campaign type to engine CampaignObjective. */
export function mapCoreTypeToObjective(coreType: string): CampaignObjective {
  const t = String(coreType).trim().toLowerCase();
  if (t === 'brand_awareness' || t === 'authority_positioning') return 'awareness';
  if (t === 'engagement_growth' || t === 'network_expansion') return 'engagement';
  if (t === 'lead_generation') return 'leads';
  if (t === 'product_promotion') return 'conversions';
  return 'awareness';
}

/** Removed DEFAULT_DURATION_WEEKS - duration must come from input.durationWeeks or blueprint. No silent 12-week default. */

export const normalizeTrendInput = (trend: TrendSignalNormalized): TrendSignalInput => ({
  topic: trend.topic,
  source: trend.source,
  geo: trend.geo,
  velocity: trend.velocity,
  sentiment: trend.sentiment,
  volume: trend.volume,
});

export const mapByTopic = (trends: TrendSignalNormalized[]) =>
  trends.reduce<Record<string, TrendSignalNormalized>>((acc, trend) => {
    acc[trend.topic.toLowerCase()] = trend;
    return acc;
  }, {});

export const pickProfileGeo = (profile: any): string | undefined => {
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

/** Build category for external API fetches. Uses strategic selection when present so trends align with user intent (e.g. Business Problems, Finding direction). */
export function pickEffectiveCategory(
  profile: any,
  strategicPayload?: StrategicPayloadInput | null
): string | undefined {
  const tiers = strategicPayload ? extractStrategicPayloadTokensByTier(strategicPayload) : null;
  const fromStrategic: string[] = [];
  if (tiers) {
    if (tiers.aspect.length) fromStrategic.push(...tiers.aspect);
    if (tiers.offerings.length) fromStrategic.push(...tiers.offerings);
    if (tiers.strategicDirection.length) fromStrategic.push(...tiers.strategicDirection.slice(0, 2));
  }
  const combined = fromStrategic.filter(Boolean).join(' ');
  if (combined.trim()) return combined.trim();
  return pickProfileCategory(profile);
}

export const containsDisqualifiedKeyword = (topic: string, disqualified: string[]): boolean => {
  const lower = topic.toLowerCase();
  return disqualified.some((kw) => {
    const k = String(kw).trim().toLowerCase();
    if (!k || k.length < 3) return false;
    // reuse tokenize logic inline to avoid circular import if tokenize is later moved
    const topicToks = lower
      .split(/[^a-z0-9]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 2);
    return lower.includes(k) || topicToks.some((t) => k.includes(t) || t.includes(k));
  });
};

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

export const loadLearningSignals = async (companyId: string, campaignId: string) => {
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

export const loadViralTopicMemory = async (campaignId: string) => {
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

export const loadLeadConversionIntelligence = async (campaignId: string) => {
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

export const extractPersonaSummary = (profile: any): PersonaSummary => {
  const normalizeList = (value?: string | null): string[] =>
    String(value || '')
      .split(/[,;/|]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);

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
  const normalizeList = (value?: string | null): string[] =>
    String(value || '')
      .split(/[,;/|]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);

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

export const buildScoringAdjustments = (
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

export const applyPersonaPlatformBias = (
  trends: TrendSignalNormalized[],
  summary: PersonaSummary,
  profile?: any
): TrendSignalNormalized[] => {
  if (trends.length === 0) return trends;
  if (!summary.platform_preferences.length && !profile) return trends;
  const weightedTokens = profile ? buildWeightedAlignmentTokens(profile) : new Map<string, number>();
  const useAlignment = weightedTokens.size > 0;
  const preferenceSet = new Set(summary.platform_preferences.map((value) => value.toLowerCase()));
  const scored = trends.map((trend, index) => {
    const platformTag = String(trend.platform_tag || '').toLowerCase();
    const source = String(trend.source || '').toLowerCase();
    const preferenceMatch =
      (platformTag && preferenceSet.has(platformTag)) || preferenceSet.has(source);
    const confidence = typeof trend.signal_confidence === 'number' ? trend.signal_confidence : 0.6;
    const alignmentScore = useAlignment ? computeAlignmentScore(trend.topic, weightedTokens) : 1;
    const baseScore = useAlignment ? alignmentScore * 0.6 + confidence * 0.4 : confidence;
    return {
      trend,
      index,
      score: baseScore + (preferenceMatch ? 0.15 : 0),
    };
  });
  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.trend);
};

export const computeScenarioOutcomes = (confidence: number, trendCount: number): ScenarioOutcomes => {
  const boost = Math.min(15, 5 + trendCount * 2);
  const decline = Math.max(8, Math.round(boost * 0.7));
  return {
    likely_case: confidence,
    best_case: Math.min(100, confidence + boost),
    worst_case: Math.max(0, confidence - decline),
  };
};

export const computeConfidence = (
  trendsUsed: TrendSignalNormalized[],
  omniConfidence?: number
): number => {
  if (typeof omniConfidence === 'number') {
    return Math.round(Math.min(100, Math.max(0, omniConfidence * 100)));
  }
  if (trendsUsed.length === 0) return 35;
  return Math.min(90, 50 + trendsUsed.length * 4);
};

export const buildExplanation = (input: {
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

export const applyTrendInfluence = (weeklyPlan: any[], trends: TrendSignalNormalized[]) => {
  const topics = trends.map((trend) => trend.topic);
  return weeklyPlan.map((week: any, index: number) => ({
    ...week,
    trend_influence: week.trend_influence?.length
      ? week.trend_influence
      : topics.slice(index, index + 3),
  }));
};

export const toProposalPlan = (weeklyPlan: any[], dailyPlan: any[]) => ({
  themes: weeklyPlan.map((week: any) => week.theme).filter(Boolean),
  topics: dailyPlan.map((day: any) => day.topic).filter(Boolean),
  hooks: dailyPlan.map((day: any) => day.CTA).filter(Boolean),
  messages: weeklyPlan.flatMap((week: any) => week.new_content_needed || []).filter(Boolean),
});

export const ensureCampaignCompanyLink = async (companyId: string, campaignId?: string | null) => {
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

export const RECOMMENDED_TOPICS_LOOKBACK_DAYS = 90;

/** Fetch recommended topics for a company from prior recommendation snapshots (like Trend campaigns). Used to seed blueprint themes. */
