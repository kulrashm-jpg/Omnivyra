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
import { generateCampaignStrategy, type CampaignObjective } from './campaignRecommendationService';
import {
  mergeTrendsAcrossSources,
  mergeSignalsAcrossRegions,
  removeDuplicates,
  tagByPlatform,
  TrendSignalNormalized,
} from './trendProcessingService';
import { normalizeTrends } from './trendNormalizationService';
import { supabase } from '../db/supabaseClient';
import { deriveDisqualifiedSignals } from './companyMissionContext';
import { buildCompanyContext } from './companyContextService';
import { polishRecommendations } from './recommendationPolishService';
import { enrichRecommendationIntelligence } from './recommendationIntelligenceService';
import { buildCompanyStrategyDNA, type CompanyStrategyDNA } from './companyStrategyDNAService';
import { analyzeStrategySignals } from './recommendationStrategyFeedbackService';
import { sequenceRecommendations } from './recommendationSequencingService';
import { buildCampaignBlueprint } from './recommendationBlueprintService';
import {
  loadRecentCompanyThemes,
  checkThemeOriginality,
  DEFAULT_ORIGINALITY_THRESHOLD,
} from '../utils/themeOriginalityGuard';
import { getCompanyPerformanceInsights } from './campaignLearningService';
import { validateCampaignBlueprint } from './recommendationBlueprintValidationService';
import {
  resolveExecutionBlueprint,
  EXECUTION_SOURCE_VALIDATED,
} from './blueprintExecutionResolver';
import { enrichRecommendationCards } from './recommendationCardEnrichmentService';
import { buildFallbackRecommendationSignals } from './recommendationFallbackSignalService';

/** Optional strategic selection from Trend tab; influences context/prompts only, not ranking. */
export type StrategicPayloadInput = {
  selected_aspect?: string | null;
  selected_offerings?: string[];
  strategic_text?: string;
  context_mode?: string;
  /** Hierarchical campaign focus: mapped core types for recommendation engine (from Campaign Focus flow). */
  mapped_core_types?: string[];
  primary_campaign_type?: string;
  context?: 'business' | 'personal' | 'third_party';
  /** Execution config from Trend execution bar; campaign_duration aligns theme count with campaign length. */
  execution_config?: { campaign_duration?: number } | null;
  [key: string]: unknown;
};

/** Map hierarchical core campaign type to engine CampaignObjective. */
function mapCoreTypeToObjective(coreType: string): CampaignObjective {
  const t = String(coreType).trim().toLowerCase();
  if (t === 'brand_awareness' || t === 'authority_positioning') return 'awareness';
  if (t === 'engagement_growth' || t === 'network_expansion') return 'engagement';
  if (t === 'lead_generation') return 'leads';
  if (t === 'product_promotion') return 'conversions';
  return 'awareness';
}

/** Strategy momentum (repetitive usage, diversification). */
export type StrategyMomentumInput = {
  dominant_streak_aspect: string | null;
  dominant_streak_count: number;
  diversification_score: number;
};

/** Strategy history for journey context (optional; does not affect ranking). */
export type StrategyMemoryInput = {
  campaigns_count: number;
  aspect_counts: Record<string, number>;
  intent_tag_counts: Record<string, number>;
  dominant_aspects: string[];
  underused_aspects: string[];
  strategy_momentum?: StrategyMomentumInput | null;
};

export type RecommendationEngineInput = {
  companyId: string;
  campaignId?: string | null;
  objective?: string;
  durationWeeks?: number;
  userId?: string | null;
  simulate?: boolean;
  selectedApiIds?: string[] | null;
  /** Multi-region: run external APIs per region and merge. Empty = use profile geo only. */
  regions?: string[];
  /** If false, use only stored company profile (skip website crawling / social discovery). */
  enrichmentEnabled?: boolean;
  /** Optional strategic selection; added to context tokens for prompts only (no ranking change). */
  strategicPayload?: StrategicPayloadInput | null;
  /** Optional strategy history (continuation/expansion); context only, no ranking change. */
  strategyMemory?: StrategyMemoryInput | null;
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
  /** When multiple regions selected. */
  global_disclaimer?: string;
  /** EXTERNAL = from APIs; PROFILE_ONLY = no external signals. */
  signals_source?: 'EXTERNAL' | 'PROFILE_ONLY';
  /** Canonical company context (when profile available). */
  company_context?: import('./companyContextService').CompanyContext;
  /** Deterministic strategy interpretation from company profile. */
  strategy_dna?: CompanyStrategyDNA;
  /** Read-only analysis of strategy strengths/weaknesses from recommendations. */
  strategy_feedback?: import('./recommendationStrategyFeedbackService').StrategyFeedback;
  /** Strategic execution ladder (sequencing only, no ranking change). */
  strategy_sequence?: import('./recommendationSequencingService').StrategySequence;
  /** Deterministic blueprint from strategy_sequence when duration known. */
  campaign_blueprint?: import('./recommendationBlueprintService').CampaignBlueprint | null;
  /** Validation result with issues and corrected blueprint. */
  campaign_blueprint_validation?: import('./recommendationBlueprintValidationService').BlueprintValidationResult;
  /** Corrected blueprint (validated version). */
  campaign_blueprint_validated?: import('./recommendationBlueprintService').CampaignBlueprint | null;
  /** Execution-safe blueprint (validated only; never raw). Use for execution flows. */
  execution_blueprint_resolved?: import('./recommendationBlueprintService').CampaignBlueprint | null;
  /** When execution_blueprint_resolved is set: "validated_blueprint". */
  execution_source?: 'validated_blueprint';
};

/** Removed DEFAULT_DURATION_WEEKS - duration must come from input.durationWeeks or blueprint. No silent 12-week default. */

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

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

/** Exported for unit testing; used in pre-filter and alignment. */
export const buildCoreProblemTokens = (profile: any): Set<string> => {
  const raw = [
    ...normalizeList(profile?.campaign_focus),
    ...normalizeList(profile?.content_themes),
    ...(Array.isArray(profile?.content_themes_list) ? profile.content_themes_list : []),
    ...(Array.isArray(profile?.authority_domains) ? profile.authority_domains : []),
    ...(profile?.core_problem_statement ? normalizeList(profile.core_problem_statement) : []),
    ...(Array.isArray(profile?.pain_symptoms) ? profile.pain_symptoms.map((s: string) => String(s).trim()).filter(Boolean) : []),
    ...(profile?.desired_transformation ? normalizeList(profile.desired_transformation) : []),
  ]
    .filter(Boolean)
    .map((s: string) => s.trim());
  const tokens = new Set(raw.flatMap((s: string) => tokenize(s)));
  return tokens;
};

const hasOverlapWithTokens = (topic: string, tokens: Set<string>): boolean => {
  if (tokens.size === 0) return true;
  const topicTokens = tokenize(topic);
  return topicTokens.some((t) => tokens.has(t));
};

const WEIGHT_HIGH = 3;
const WEIGHT_MEDIUM = 2;
const WEIGHT_LOW = 1;

const GENERIC_TOKEN_BLACKLIST = new Set([
  'tools',
  'software',
  'platform',
  'strategies',
  'tips',
]);

const DOWNWEIGHT_TOKENS = new Set([
  'marketing',
  'growth',
  'tech',
  'engagement',
]);

/** Exported for unit testing; used in alignment scoring. */
export const buildWeightedAlignmentTokens = (profile: any): Map<string, number> => {
  const map = new Map<string, number>();
  const addWithWeight = (values: string[], w: number) => {
    values.forEach((s) =>
      tokenize(s).forEach((t) => {
        if (GENERIC_TOKEN_BLACKLIST.has(t)) return;
        const effectiveWeight = DOWNWEIGHT_TOKENS.has(t) ? w * 0.5 : w;
        const current = map.get(t) ?? 0;
        if (effectiveWeight > current) map.set(t, effectiveWeight);
      })
    );
  };
  addWithWeight(normalizeList(profile?.campaign_focus), WEIGHT_HIGH);
  addWithWeight(normalizeList(profile?.content_themes), WEIGHT_MEDIUM);
  addWithWeight(normalizeList(profile?.growth_priorities), WEIGHT_MEDIUM);
  addWithWeight(normalizeList(profile?.industry), WEIGHT_LOW);
  addWithWeight(normalizeList(profile?.goals), WEIGHT_LOW);
  addWithWeight(
    (Array.isArray(profile?.content_themes_list) ? profile.content_themes_list : []).map(
      (s: string) => String(s).trim()
    ),
    WEIGHT_MEDIUM
  );
  addWithWeight(
    (Array.isArray(profile?.industry_list) ? profile.industry_list : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_LOW
  );
  addWithWeight(
    (Array.isArray(profile?.goals_list) ? profile.goals_list : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_LOW
  );
  addWithWeight(
    (Array.isArray(profile?.authority_domains) ? profile.authority_domains : []).map((s: string) =>
      String(s).trim()
    ),
    WEIGHT_HIGH
  );
  if (profile?.core_problem_statement) {
    addWithWeight(normalizeList(profile.core_problem_statement), WEIGHT_HIGH);
  }
  if (Array.isArray(profile?.pain_symptoms)) {
    addWithWeight(
      profile.pain_symptoms.map((s: string) => String(s).trim()).filter(Boolean),
      WEIGHT_HIGH
    );
  }
  if (profile?.desired_transformation) {
    addWithWeight(normalizeList(profile.desired_transformation), WEIGHT_HIGH);
  }
  return map;
};

const computeAlignmentScore = (topic: string, weightedTokens: Map<string, number>): number => {
  if (weightedTokens.size === 0) return 1;
  const topicTokens = tokenize(topic);
  if (topicTokens.length === 0) return 0;
  const topicSet = new Set(topicTokens);
  let weightedOverlap = 0;
  let maxWeight = 0;
  weightedTokens.forEach((w, t) => {
    maxWeight += w;
    if (topicSet.has(t)) weightedOverlap += w;
  });
  if (maxWeight <= 0) return 1;
  return Number(Math.min(1, (weightedOverlap / maxWeight)).toFixed(4));
};

const STRATEGY_MODIFIER_MIN = 0.85;
const STRATEGY_MODIFIER_MAX = 1.25;

const COMMERCIAL_TOKENS = new Set([
  'pricing',
  'revenue',
  'roi',
  'sales',
  'conversion',
  'pipeline',
  'buyer',
]);
const AWARENESS_TOPIC_TOKENS = new Set([
  'awareness',
  'discovery',
  'introduction',
  'learn',
  'education',
]);
const TECHNICAL_OR_AUTHORITY_TOKENS = new Set([
  'api',
  'sdk',
  'kubernetes',
  'terraform',
  'devops',
  'microservice',
  'thought',
  'leadership',
  'expertise',
  'framework',
]);

/** Strategy-aware scoring modifier. Returns value in [0.85, 1.25]. If strategyDNA missing → 1. */
function computeStrategyModifier(
  strategyDNA: CompanyStrategyDNA | null | undefined,
  trend: TrendSignalNormalized,
  profile: any,
  opts?: { alignmentScore?: number; volumeMedian?: number; volumeMax?: number }
): number {
  if (!strategyDNA) return 1;

  const topic = String(trend.topic || '').toLowerCase();
  const topicTokens = new Set(tokenize(topic));
  const vol = Number(trend.volume ?? 0) || 0;
  const freq = trend.frequency ?? 0;
  const volumeMedian = opts?.volumeMedian ?? 0;
  const volumeMax = opts?.volumeMax ?? 1;
  const alignmentScore = opts?.alignmentScore ?? 0.5;
  const isFrequencyLow = freq <= 2;
  const isVolumeBelowMedian = volumeMedian > 0 && vol < volumeMedian;
  const isAlignmentHigh = alignmentScore >= 0.5;

  let modifier = 1;

  switch (strategyDNA.mode) {
    case 'problem_transformation': {
      const problemTokens = new Set([
        ...(profile?.core_problem_statement
          ? tokenize(String(profile.core_problem_statement))
          : []),
        ...(Array.isArray(profile?.pain_symptoms)
          ? profile.pain_symptoms.flatMap((s: string) => tokenize(s))
          : []),
        ...(profile?.desired_transformation
          ? tokenize(String(profile.desired_transformation))
          : []),
      ].filter((t) => t.length > 2));
      if (problemTokens.size > 0 && [...topicTokens].some((t) => problemTokens.has(t))) modifier += 0.15;
      if (isAlignmentHigh && (isFrequencyLow || isVolumeBelowMedian)) modifier += 0.10;
      break;
    }
    case 'authority_positioning': {
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      if (authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t))) modifier += 0.20;
      if (isFrequencyLow) modifier += 0.05;
      break;
    }
    case 'commercial_growth': {
      const hasCommercial = [...topicTokens].some((t) => COMMERCIAL_TOKENS.has(t));
      if (hasCommercial) modifier += 0.15;
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      const problemTokens = new Set([
        ...(profile?.core_problem_statement
          ? tokenize(String(profile.core_problem_statement))
          : []),
        ...(Array.isArray(profile?.pain_symptoms)
          ? profile.pain_symptoms.flatMap((s: string) => tokenize(s))
          : []),
      ].filter((t) => t.length > 2));
      const hasAuthorityOverlap = authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t));
      const hasProblemOverlap = problemTokens.size > 0 && [...topicTokens].some((t) => problemTokens.has(t));
      const isAwarenessOnly =
        !hasCommercial && !hasAuthorityOverlap && !hasProblemOverlap &&
        [...topicTokens].some((t) => AWARENESS_TOPIC_TOKENS.has(t));
      if (isAwarenessOnly) modifier -= 0.10;
      break;
    }
    case 'audience_engagement': {
      const audienceTokens = new Set(
        [
          ...(profile?.target_audience ? tokenize(String(profile.target_audience)) : []),
          ...(profile?.brand_voice ? tokenize(String(profile.brand_voice)) : []),
        ].filter((t) => t.length > 2)
      );
      if (audienceTokens.size > 0 && [...topicTokens].some((t) => audienceTokens.has(t))) modifier += 0.10;
      const authTokens = new Set(
        (Array.isArray(profile?.authority_domains) ? profile.authority_domains : [])
          .flatMap((s: string) => tokenize(s))
          .filter((t) => t.length > 2)
      );
      const isTechnicalOrAuthorityHeavy =
        [...topicTokens].some((t) => TECHNICAL_OR_AUTHORITY_TOKENS.has(t)) ||
        (authTokens.size > 0 && [...topicTokens].some((t) => authTokens.has(t)));
      if (isTechnicalOrAuthorityHeavy) modifier -= 0.05;
      break;
    }
    case 'educational_default':
    default:
      modifier = 1;
  }

  return Math.max(STRATEGY_MODIFIER_MIN, Math.min(STRATEGY_MODIFIER_MAX, modifier));
}

const computeMedian = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const scoreByAlignmentThenPopularity = (
  signals: TrendSignalNormalized[],
  profile: any
): TrendSignalNormalized[] => {
  const weightedTokens = buildWeightedAlignmentTokens(profile);
  const strategyDNA = profile ? buildCompanyStrategyDNA(profile) : null;
  const volumes = signals.map((s) => Number(s.volume ?? 0) || 0);
  const volumeMax = Math.max(...volumes, 1);
  const volumeMedian = computeMedian(volumes);

  return [...signals].sort((a, b) => {
    const alignA = computeAlignmentScore(a.topic, weightedTokens);
    const alignB = computeAlignmentScore(b.topic, weightedTokens);
    const modA = computeStrategyModifier(strategyDNA, a, profile, {
      alignmentScore: alignA,
      volumeMax,
      volumeMedian,
    });
    const modB = computeStrategyModifier(strategyDNA, b, profile, {
      alignmentScore: alignB,
      volumeMax,
      volumeMedian,
    });
    const finalA = alignA * modA;
    const finalB = alignB * modB;
    if (finalB !== finalA) return finalB - finalA;
    const freqB = b.frequency ?? 0;
    const freqA = a.frequency ?? 0;
    if (freqB !== freqA) return freqB - freqA;
    const volB = b.volume ?? 0;
    const volA = a.volume ?? 0;
    return volB - volA;
  });
};

/** @internal Exported for unit testing weighted alignment scoring and diamond scoring guard */
export {
  computeAlignmentScore,
  computeStrategyModifier,
  scoreByAlignmentThenPopularity,
};

const containsDisqualifiedKeyword = (topic: string, disqualified: string[]): boolean => {
  const lower = topic.toLowerCase();
  return disqualified.some((kw) => {
    const k = String(kw).trim().toLowerCase();
    if (!k || k.length < 3) return false;
    return lower.includes(k) || tokenize(topic).some((t) => k.includes(t) || t.includes(k));
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

const RECOMMENDED_TOPICS_LOOKBACK_DAYS = 90;

/** Fetch recommended topics for a company from prior recommendation snapshots (like Trend campaigns). Used to seed blueprint themes. */
export async function getRecommendedTopicsForCompany(
  companyId: string,
  limit = 15
): Promise<string[]> {
  const since = new Date(
    Date.now() - RECOMMENDED_TOPICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await supabase
    .from('recommendation_snapshots')
    .select('trend_topic, final_score')
    .eq('company_id', companyId)
    .gte('created_at', since)
    .not('trend_topic', 'is', null);

  if (error || !data?.length) return [];

  const byTopic = new Map<string, number>();
  for (const row of data as { trend_topic: string; final_score?: number }[]) {
    const topic = String(row?.trend_topic || '').trim();
    if (!topic) continue;
    const score = typeof row.final_score === 'number' ? row.final_score : 0;
    const existing = byTopic.get(topic) ?? -1;
    if (score > existing) byTopic.set(topic, score);
  }
  return Array.from(byTopic.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

export const generateRecommendations = async (
  input: RecommendationEngineInput,
  options?: {
    onContext?: (context: Record<string, any>) => void;
  }
): Promise<RecommendationEngineResult> => {
  await ensureCampaignCompanyLink(input.companyId, input.campaignId);
  const useEnrichment = input.enrichmentEnabled !== false;
  const profile = await getProfile(input.companyId, { autoRefine: useEnrichment, languageRefine: true });
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

  const execConfig = input.strategicPayload?.execution_config as { campaign_duration?: number } | undefined;
  const execDuration =
    execConfig != null &&
    typeof execConfig.campaign_duration === 'number' &&
    execConfig.campaign_duration >= 4 &&
    execConfig.campaign_duration <= 12
      ? execConfig.campaign_duration
      : null;
  let rawDurationWeeks = input.durationWeeks ?? execDuration ?? 12;
  rawDurationWeeks = Math.max(4, Math.min(12, rawDurationWeeks));
  const { normalizeCampaignDuration } = await import('../utils/durationNormalization');
  const normalized = normalizeCampaignDuration(rawDurationWeeks);
  const durationWeeks = normalized.normalized;

  const recommendationContext: Record<string, unknown> = {
    campaign_intelligence: campaignIntelligence,
    recent_campaign_intelligence: recentCampaignIntelligence,
    selected_api_ids: Array.isArray(input.selectedApiIds) ? input.selectedApiIds : null,
    campaign_duration_weeks: rawDurationWeeks,
    normalized_campaign_duration: normalized.normalized,
    expected_number_of_weeks: rawDurationWeeks,
    strategic_arc_type: normalized.strategic_arc_type,
  };
  if (input.strategicPayload && typeof input.strategicPayload === 'object') {
    recommendationContext.strategic_selection = {
      selected_aspect: input.strategicPayload.selected_aspect ?? null,
      selected_offerings: Array.isArray(input.strategicPayload.selected_offerings)
        ? input.strategicPayload.selected_offerings
        : [],
    };
    if (Array.isArray(input.strategicPayload.mapped_core_types) && input.strategicPayload.mapped_core_types.length > 0) {
      recommendationContext.campaign_focus = {
        primary_campaign_type: input.strategicPayload.primary_campaign_type ?? null,
        context: input.strategicPayload.context ?? null,
        mapped_core_types: input.strategicPayload.mapped_core_types,
      };
    }
  }
  if (input.strategyMemory && typeof input.strategyMemory === 'object') {
    recommendationContext.strategy_memory = {
      aspect_counts: input.strategyMemory.aspect_counts ?? {},
      intent_tag_counts: input.strategyMemory.intent_tag_counts ?? {},
      dominant_aspects: input.strategyMemory.dominant_aspects ?? [],
      underused_aspects: input.strategyMemory.underused_aspects ?? [],
    };
    if (input.strategyMemory.strategy_momentum && typeof input.strategyMemory.strategy_momentum === 'object') {
      recommendationContext.strategy_momentum = input.strategyMemory.strategy_momentum;
    }
  }
  try {
    const performanceInsights = await getCompanyPerformanceInsights(input.companyId);
    recommendationContext.company_high_performing_themes = performanceInsights.company_high_performing_themes;
    recommendationContext.company_high_performing_platforms = performanceInsights.company_high_performing_platforms;
    recommendationContext.company_high_performing_content_types = performanceInsights.company_high_performing_content_types;
    recommendationContext.company_low_performing_patterns = performanceInsights.company_low_performing_patterns;
    recommendationContext.company_performance_usage_note =
      'Use performance insights as GUIDANCE only (weight ~30%). Do not override trend intelligence. Maintain exploration: at least one theme per campaign should be experimental.';
  } catch {
    recommendationContext.company_high_performing_themes = [];
    recommendationContext.company_high_performing_platforms = [];
    recommendationContext.company_high_performing_content_types = [];
    recommendationContext.company_low_performing_patterns = [];
  }

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

  const mappedCore = Array.isArray(input.strategicPayload?.mapped_core_types) && input.strategicPayload.mapped_core_types.length > 0
    ? input.strategicPayload.mapped_core_types[0]
    : null;
  const rawObjective = input.objective ?? 'awareness';
  const objective: CampaignObjective = mappedCore
    ? mapCoreTypeToObjective(mappedCore)
    : (typeof rawObjective === 'string' && rawObjective.includes('_') ? mapCoreTypeToObjective(rawObjective) : (rawObjective as CampaignObjective));
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

  const regions = Array.isArray(input.regions) ? input.regions.filter((r) => String(r).trim()) : [];
  const effectiveRegions =
    regions.length > 0
      ? regions
      : Array.isArray(profile?.geography_list) && profile.geography_list.length > 0
        ? profile.geography_list.map((g: any) => String(g).trim()).filter(Boolean)
        : [];
  let rawSignals: TrendSignal[] = [];
  let missingEnvPlaceholders: string[] = [];
  const category = pickProfileCategory(profile);

  let merged: TrendSignalNormalized[];
  let tagged: TrendSignalNormalized[];

  if (effectiveRegions.length > 0) {
    const perRegionSignals: Array<{ region: string; signals: TrendSignal[] }> = [];
    for (const regionCode of effectiveRegions) {
      const geo = String(regionCode).trim().toUpperCase() === 'GLOBAL' ? undefined : String(regionCode).trim();
      try {
        const externalSummary = await fetchExternalApis(
          input.companyId,
          geo ?? pickProfileGeo(profile),
          category,
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
            health: result.health && result.source
              ? { api_source_id: result.source.id, ...result.health }
              : null,
            geo: geo ?? pickProfileGeo(profile),
            category,
          }))
        );
        if (!missingEnvPlaceholders.length && externalSummary.missing_env_placeholders?.length)
          missingEnvPlaceholders = externalSummary.missing_env_placeholders;
        const signals: TrendSignal[] = normalizedTrends.map((trend) => ({
          topic: trend.title,
          source: trend.source,
          geo: trend.geo,
          volume: trend.volume,
          sentiment: undefined,
          velocity: undefined,
          signal_confidence: trend.confidence,
          trend_source_health: undefined,
        }));
        perRegionSignals.push({ region: regionCode.trim(), signals });
      } catch (err) {
        console.warn('EXTERNAL_API_FETCH_FAILED_REGION', { region: regionCode });
      }
    }
    merged = mergeSignalsAcrossRegions(perRegionSignals);
    tagged = tagByPlatform(merged);
  } else {
    try {
      const externalSummary = await fetchExternalApis(
        input.companyId,
        pickProfileGeo(profile),
        category,
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
          health: result.health && result.source
            ? { api_source_id: result.source.id, ...result.health }
            : null,
          geo: pickProfileGeo(profile),
          category,
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
    merged = mergeTrendsAcrossSources(deduped);
    tagged = tagByPlatform(merged);
  }

  let usedFallbackContextSignals = false;
  if (tagged.length === 0) {
    console.warn('EXTERNAL_API_NO_SIGNALS');
    const fallbackSignals = buildFallbackRecommendationSignals(profile ?? null);
    if (fallbackSignals.length > 0) {
      merged = mergeTrendsAcrossSources(fallbackSignals);
      tagged = tagByPlatform(merged).map((trend) => ({
        ...trend,
        platform_tag: trend.platform_tag ?? 'context',
      }));
      usedFallbackContextSignals = tagged.length > 0;
    }
    if (!usedFallbackContextSignals) {
      console.warn('FALLBACK_NO_SIGNALS');
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
        company_context: profile ? buildCompanyContext(profile) : undefined,
        omnivyra_status: {
          status: healthReport.status,
          confidence: undefined,
          contract_version: lastMeta?.contract_version,
          latency_ms: lastMeta?.latency_ms,
          fallback_reason: getLastFallbackReason() ?? (isOmniVyraEnabled() ? null : 'omnivyra_disabled'),
          last_error: healthReport.last_error,
          endpoint: lastMeta?.endpoint ?? null,
        },
        global_disclaimer: effectiveRegions.length > 1 ? 'Trend signals vary across selected geographies. Local validation recommended.' : undefined,
        signals_source: 'PROFILE_ONLY' as const,
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
  }

  const coreProblemTokens = buildCoreProblemTokens(profile);
  const disqualifiedSignals = deriveDisqualifiedSignals(profile as any);
  const [trendsToScore, filteredOut] = tagged.reduce<
    [TrendSignalNormalized[], TrendSignalNormalized[]]
  >(
    ([keep, ignore], trend) => {
      const hasOverlap = hasOverlapWithTokens(trend.topic, coreProblemTokens);
      const isDisqualified = containsDisqualifiedKeyword(trend.topic, disqualifiedSignals);
      if (!hasOverlap || isDisqualified) {
        return [keep, [...ignore, trend]];
      }
      return [[...keep, trend], ignore];
    },
    [[], []]
  );

  let trendsUsed = trendsToScore;
  let trendsIgnored: TrendSignalNormalized[] = [...filteredOut];
  let omnivyraMeta: RecommendationEngineResult['omnivyra_metadata'] = undefined;
  let fallbackReason: string | null = null;

  if (isOmniVyraEnabled()) {
    const relevance = await getTrendRelevance({
      signals: trendsToScore.map(normalizeTrendInput),
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
      const omnivyraIgnored = ignored
        .map((item: any) => byTopic[String(item?.topic || item).toLowerCase()])
        .filter(Boolean);
      trendsIgnored = [...filteredOut, ...omnivyraIgnored];
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
    trendsUsed = scoreByAlignmentThenPopularity(trendsUsed, profile);
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

  trendsUsed = applyPersonaPlatformBias(trendsUsed, personaSummary, profile);
  const polished = polishRecommendations(trendsUsed, profile);
  if (polished.length > 0) {
    trendsUsed = polished as unknown as TrendSignalNormalized[];
  }
  const enriched = enrichRecommendationIntelligence(trendsUsed, profile);
  if (enriched.length > 0) {
    trendsUsed = enriched as unknown as TrendSignalNormalized[];
  }
  const strategyDNA = profile ? buildCompanyStrategyDNA(profile) : null;
  const strategySequence =
    trendsUsed.length > 0 ? sequenceRecommendations(trendsUsed, strategyDNA) : undefined;
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
  if (allUnhealthy && !usedFallbackContextSignals) {
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
      company_context: profile ? buildCompanyContext(profile) : undefined,
      strategy_dna: profile ? buildCompanyStrategyDNA(profile) : undefined,
      strategy_feedback: profile ? analyzeStrategySignals([], buildCompanyStrategyDNA(profile), profile) : undefined,
      omnivyra_status: {
        status: healthReport.status,
        confidence: undefined,
        contract_version: lastMeta?.contract_version,
        latency_ms: lastMeta?.latency_ms,
        fallback_reason: getLastFallbackReason() ?? (isOmniVyraEnabled() ? null : 'omnivyra_disabled'),
        last_error: healthReport.last_error,
        endpoint: lastMeta?.endpoint ?? null,
      },
      global_disclaimer: effectiveRegions.length > 1 ? 'Trend signals vary across selected geographies. Local validation recommended.' : undefined,
      signals_source: 'PROFILE_ONLY' as const,
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
  let result = {
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
    global_disclaimer: effectiveRegions.length > 1 ? 'Trend signals vary across selected geographies. Local validation recommended.' : undefined,
    signals_source: (usedFallbackContextSignals ? 'PROFILE_ONLY' : 'EXTERNAL') as 'PROFILE_ONLY' | 'EXTERNAL',
    company_context: profile ? buildCompanyContext(profile) : undefined,
    strategy_dna: profile ? buildCompanyStrategyDNA(profile) : undefined,
    strategy_feedback:
      profile && trendsUsed.length > 0
        ? analyzeStrategySignals(trendsUsed, strategyDNA ?? undefined, profile)
        : undefined,
    strategy_sequence: strategySequence,
    campaign_blueprint: (() => {
      if (strategySequence == null || durationWeeks == null) return undefined;
      if (input.companyId) {
        const topics = (strategySequence.ladder ?? [])
          .flatMap((e) => (e.recommendations ?? []).map((r) => String(r.topic ?? '').trim()))
          .filter(Boolean);
        if (topics.length > 0) {
          loadRecentCompanyThemes(input.companyId, 50)
            .then((recent) => {
              const { hasOverlap, overlappingPairs, maxScore } = checkThemeOriginality(
                topics,
                recent,
                DEFAULT_ORIGINALITY_THRESHOLD
              );
              if (hasOverlap) {
                console.warn(
                  '[recommendationEngine] Theme originality guard: overlap with recent campaigns',
                  { overlappingPairs: overlappingPairs.slice(0, 5), maxScore: maxScore.toFixed(2) }
                );
              }
            })
            .catch(() => {});
        }
      }
      return buildCampaignBlueprint(strategySequence, durationWeeks, normalized.strategic_arc_type);
    })(),
    campaign_blueprint_validation: undefined,
    campaign_blueprint_validated: undefined,
  } as RecommendationEngineResult;

  if (result.campaign_blueprint != null) {
    const validation = validateCampaignBlueprint(result.campaign_blueprint);
    result.campaign_blueprint_validation = validation;
    result.campaign_blueprint_validated = validation.corrected_blueprint;
  }

  result = enrichRecommendationCards(result);

  const executionBlueprint = resolveExecutionBlueprint(result);
  if (executionBlueprint != null) {
    result.execution_blueprint_resolved = executionBlueprint;
    result.execution_source = EXECUTION_SOURCE_VALIDATED;
  }

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

