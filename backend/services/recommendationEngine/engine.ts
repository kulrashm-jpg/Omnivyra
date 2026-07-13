import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
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
import { deriveDisqualifiedSignals } from '../companyMissionContext';
import { buildCompanyContext } from '../companyContextService';
import { getCompanyContextIntelligence } from '../companyContextIntelligenceService';
import { polishRecommendations } from '../recommendationPolishService';
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
import { loadRecommendedTopicSnapshotRows } from '../../repositories/recommendationEngineReadRepository';

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
import {
  attachIntelligenceSignalIds,
  mapCoreTypeToObjective,
  pickEffectiveCategory,
  RECOMMENDED_TOPICS_LOOKBACK_DAYS,
  ensureCampaignCompanyLink,
  extractPersonaSummary,
  loadLearningSignals,
  loadViralTopicMemory,
  loadLeadConversionIntelligence,
  pickProfileGeo,
  computeConfidence,
  buildScoringAdjustments,
  computeScenarioOutcomes,
  buildExplanation,
  containsDisqualifiedKeyword,
  normalizeTrendInput,
  mapByTopic,
  applyTrendInfluence,
  toProposalPlan,
  applyPersonaPlatformBias,
} from "./engineHelpers";

export async function getRecommendedTopicsForCompany(
  companyId: string,
  limit = 15
): Promise<string[]> {
  const since = new Date(
    Date.now() - RECOMMENDED_TOPICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const data = await loadRecommendedTopicSnapshotRows(companyId, since);

  if (!data.length) return [];

  const byTopic = new Map<string, number>();
  for (const row of data) {
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

/**
 * PMF-007 — the Recommendation Engine seam. Default 'legacy' runs the existing engine
 * core byte-identically. On the platform path (flag-gated) the SAME core runs inside
 * the Recommendation AIA agent, which orchestrates the Recommendation Graph
 * (dependency-ordered waves, checkpoints, resume, approval, recovery); the producing
 * node executes through AIC (CKC knowledge, validation, telemetry) with this core as
 * the backend, and the EXACT core result is served (parity) — additively annotated
 * with an explanation (§7) under a reserved key — with a safety net.
 */
export const generateRecommendations = async (
  input: RecommendationEngineInput,
  options?: {
    onContext?: (context: Record<string, any>) => void;
  }
): Promise<RecommendationEngineResult> => {
  const { shouldRunPlatform } = await import('../recommendationCapability/recommendationMigrationFlag');
  if (shouldRunPlatform()) {
    const { runRecommendationsViaPlatform } = await import('../recommendationCapability/recommendationPlatformRuntime');
    return runRecommendationsViaPlatform<RecommendationEngineResult>({
      companyId: input.companyId,
      generate: () => generateRecommendationsCore(input, options),
      correlationId: input.campaignId ?? undefined,
    });
  }
  return generateRecommendationsCore(input, options);
};

const generateRecommendationsCore = async (
  input: RecommendationEngineInput,
  options?: {
    onContext?: (context: Record<string, any>) => void;
  }
): Promise<RecommendationEngineResult> => {
  await ensureCampaignCompanyLink(input.companyId, input.campaignId);
  const useEnrichment = input.enrichmentEnabled !== false;
  const profile = await getProfile(input.companyId, { autoRefine: useEnrichment, languageRefine: true });
  const intelligenceContext = await getCompanyContextIntelligence(input.companyId).catch(() => null);
  const companyContext = profile ? buildCompanyContext(profile, { intelligence: intelligenceContext }) : undefined;
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
  let rawDurationWeeks = input.durationWeeks ?? execDuration ?? 4;
  rawDurationWeeks = Math.max(4, Math.min(12, rawDurationWeeks));
  const { normalizeCampaignDuration } = await import('../../utils/durationNormalization');
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
      selected_aspects: Array.isArray(input.strategicPayload.selected_aspects)
        ? input.strategicPayload.selected_aspects
        : [],
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
  const category = pickEffectiveCategory(profile, input.strategicPayload);
  const insightSource = input.insightSource ?? 'hybrid';

  let merged: TrendSignalNormalized[];
  let tagged: TrendSignalNormalized[];

  if (insightSource === 'llm') {
    const { getStrategicThemesAsOpportunities } = await import('../strategicThemeEngine');
    const { getThemesForCompany } = await import('../companyTrendRelevanceEngine');

    let themes: Array<{ title: string; summary?: string | null; payload?: Record<string, unknown> }>;
    const companyThemes = await getThemesForCompany(input.companyId, 0);
    if (companyThemes.length > 0) {
      themes = companyThemes.map(({ theme }) => ({
        title: String(theme.theme_title ?? theme.title ?? '').trim() || 'Strategic theme',
        summary: (theme.theme_description ?? theme.summary) as string | null,
        payload: {
          momentum_score: (theme.momentum_score ?? 0.5) as number,
          trend_direction: theme.trend_direction ?? null,
          companies: theme.companies ?? [],
          keywords: theme.keywords ?? [],
          influencers: theme.influencers ?? [],
          strategic_theme_id: theme.id,
        },
      }));
    } else {
      themes = await getStrategicThemesAsOpportunities({ companyId: input.companyId, limit: 20 });
    }

    // If both DB sources returned nothing, generate fresh AI themes for this company.
    // This is the primary intent of the "AI" insight source option.
    if (themes.length === 0) {
      try {
        const { generateAdditionalStrategicThemes } = await import('../strategicThemeEngine');
        const { generateThemeKey } = await import('../themeKeyService');
        const { getExcludedThemeTopicsForCompany } = await import('../companyThemeStateService');
        const excludedKeys = await getExcludedThemeTopicsForCompany(input.companyId);
        const excludedSet = new Set(excludedKeys);
        const rankingCtx = { historicalThemeCache: new Map<string, Set<string>>() };
        const aiThemes = await generateAdditionalStrategicThemes({
          companyId: input.companyId,
          strategicPayload: input.strategicPayload,
          limit: 15,
          existingThemeKeys: [...excludedSet],
          rankingContext: rankingCtx,
          correlation: { referenceType: 'recommendation_generation', referenceId: input.campaignId ?? input.companyId, parentActivityId: input.campaignId ?? null },
        });
        themes = aiThemes
          .filter((t) => !excludedSet.has(generateThemeKey(t.topic)))
          .map((t) => ({ title: t.topic, summary: null }));
      } catch (aiErr) {
        console.warn('[LLM_PATH] Direct AI theme generation failed, falling through to signal pipeline', aiErr);
      }
    }

    const strategicTokens = buildCoreProblemTokens(profile, input.strategicPayload);
    if (strategicTokens.size > 0) {
      themes = [...themes].sort((a, b) => {
        const aTitle = (a.title ?? '').toLowerCase();
        const bTitle = (b.title ?? '').toLowerCase();
        const aScore = [...strategicTokens].filter((t) => aTitle.includes(t)).length;
        const bScore = [...strategicTokens].filter((t) => bTitle.includes(t)).length;
        if (bScore !== aScore) return bScore - aScore;
        return 0;
      });
    }
    themes = themes.slice(0, 20);

    const llmSignals: TrendSignal[] = themes.map((t) => {
      const momentumScore = (t.payload as { momentum_score?: number } | undefined)?.momentum_score;
      return {
        topic: t.title,
        source: 'strategic_themes',
        geo: pickProfileGeo(profile),
        volume: momentumScore != null ? momentumScore * 100 : 50,
        sentiment: undefined,
        velocity: momentumScore ?? 0.5,
        signal_confidence: 0.8,
        trend_source_health: undefined,
      };
    });
    const deduped = removeDuplicates(llmSignals);
    merged = mergeTrendsAcrossSources(deduped);
    tagged = tagByPlatform(merged);
  } else if (effectiveRegions.length > 0) {
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
      console.warn('FALLBACK_NO_SIGNALS — attempting AI theme generation before giving up');
      // Try AI-generated themes from company profile + strategic payload before returning empty.
      try {
        const { generateAdditionalStrategicThemes } = await import('../strategicThemeEngine');
        const { generateThemeKey } = await import('../themeKeyService');
        const { getExcludedThemeTopicsForCompany } = await import('../companyThemeStateService');
        const excludedKeys = await getExcludedThemeTopicsForCompany(input.companyId);
        const excludedSet = new Set(excludedKeys);
        const rankingCtx = { historicalThemeCache: new Map<string, Set<string>>() };
        const aiThemes = await generateAdditionalStrategicThemes({
          companyId: input.companyId,
          strategicPayload: input.strategicPayload,
          limit: 10,
          existingThemeKeys: [...excludedSet],
          rankingContext: rankingCtx,
          correlation: { referenceType: 'recommendation_generation', referenceId: input.campaignId ?? input.companyId, parentActivityId: input.campaignId ?? null },
        });
        const validThemes = aiThemes.filter((t) => !excludedSet.has(generateThemeKey(t.topic)));
        if (validThemes.length > 0) {
          merged = mergeTrendsAcrossSources(validThemes.map((t) => ({
            topic: t.topic,
            source: 'ai_generated_fallback',
            volume: 60,
            signal_confidence: 0.6,
          } as TrendSignal)));
          tagged = tagByPlatform(merged);
          usedFallbackContextSignals = tagged.length > 0;
        }
      } catch (aiErr) {
        console.warn('FALLBACK_AI_THEME_GENERATION_FAILED', aiErr);
      }
    }

    if (!usedFallbackContextSignals) {
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
      const healthReport = getOmnivyraHealthReport();
      const lastMeta = getLastMeta();
      if (!isOmnivyraEnabled()) {
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
        company_context: companyContext,
        omnivyra_status: {
          status: healthReport.status,
          confidence: undefined,
          contract_version: lastMeta?.contract_version,
          latency_ms: lastMeta?.latency_ms,
          fallback_reason: getLastFallbackReason() ?? (isOmnivyraEnabled() ? null : 'omnivyra_disabled'),
          last_error: healthReport.last_error,
          endpoint: lastMeta?.endpoint ?? null,
        },
        global_disclaimer: effectiveRegions.length > 1 ? 'Trend signals vary across selected geographies. Local validation recommended.' : undefined,
        signals_source: 'PROFILE_ONLY' as const,
      } as RecommendationEngineResult;

      if (isOmnivyraEnabled()) {
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

  if (input.strategicPayload && typeof input.strategicPayload === 'object') {
    const tiers = extractStrategicPayloadTokensByTier(input.strategicPayload);
    console.log('[STRATEGIC_TRACE] Trend Campaign payload received', {
      strategicDirection: tiers.strategicDirection.length,
      aspect: tiers.aspect.length,
      offerings: tiers.offerings.length,
      campaignFocus: tiers.campaignFocus.length,
      other: tiers.other.length,
      sample: {
        strategicDirection: tiers.strategicDirection.slice(0, 2),
        aspect: tiers.aspect,
        offerings: tiers.offerings.slice(0, 3),
        campaignFocus: tiers.campaignFocus.slice(0, 2),
      },
    });
  } else {
    console.log('[STRATEGIC_TRACE] No Trend Campaign payload (parent-page or legacy flow)');
  }

  const coreProblemTokens = buildCoreProblemTokens(profile, input.strategicPayload);
  const disqualifiedSignals = deriveDisqualifiedSignals(profile as any);

  tagged = await attachIntelligenceSignalIds(input.companyId, tagged);

  if (input.strategicPayload && typeof input.strategicPayload === 'object') {
    const tiers = extractStrategicPayloadTokensByTier(input.strategicPayload);
    console.log('[STRATEGIC_TRACE] Trend Campaign payload received', {
      tier_counts: {
        strategicDirection: tiers.strategicDirection.length,
        aspect: tiers.aspect.length,
        offerings: tiers.offerings.length,
        campaignFocus: tiers.campaignFocus.length,
        other: tiers.other.length,
      },
      sample: {
        strategicDirection: tiers.strategicDirection.slice(0, 2),
        aspect: tiers.aspect[0] ?? null,
        offerings: tiers.offerings.slice(0, 3),
        campaignFocus: tiers.campaignFocus.slice(0, 2),
      },
      regions: input.regions?.length ?? 0,
    });
  }

  const [trendsToScore, filteredOut] = tagged.reduce<
    [TrendSignalNormalized[], TrendSignalNormalized[]]
  >(
    ([keep, ignore], trend) => {
      // AI-generated and LLM-sourced signals are already semantically matched to company
      // context — applying keyword overlap would incorrectly filter them out since AI themes
      // use varied phrasing that doesn't echo exact profile tokens.
      const isAiSourced =
        usedFallbackContextSignals ||
        insightSource === 'llm' ||
        trend.source === 'ai_generated_fallback' ||
        trend.source === 'strategic_themes';
      const hasOverlap = isAiSourced || hasOverlapWithTokens(trend.topic, coreProblemTokens);
      const isDisqualified = containsDisqualifiedKeyword(trend.topic, disqualifiedSignals);
      if (!hasOverlap || isDisqualified) {
        return [keep, [...ignore, trend]];
      }
      return [[...keep, trend], ignore];
    },
    [[], []]
  );

  console.log('[STRATEGIC_TRACE] Filter results', {
    raw_signals: tagged.length,
    passed_filter: trendsToScore.length,
    filtered_out: filteredOut.length,
    passed_topics: trendsToScore.slice(0, 8).map((t) => t.topic),
    filtered_out_sample: filteredOut.slice(0, 5).map((t) => t.topic),
  });

  let trendsUsed = trendsToScore;
  let trendsIgnored: TrendSignalNormalized[] = [...filteredOut];
  let omnivyraMeta: RecommendationEngineResult['omnivyra_metadata'] = undefined;
  let fallbackReason: string | null = null;

  if (isOmnivyraEnabled() && insightSource !== 'api') {
    const companyProfileForOmnivyra = profile
      ? {
          ...profile,
          strategic_context:
            input.strategicPayload && typeof input.strategicPayload === 'object'
              ? {
                  selected_aspect: input.strategicPayload.selected_aspect ?? null,
                  selected_aspects: input.strategicPayload.selected_aspects ?? [],
                  selected_offerings: input.strategicPayload.selected_offerings ?? [],
                  strategic_text: input.strategicPayload.strategic_text ?? null,
                  cluster_inputs: input.strategicPayload.cluster_inputs ?? [],
                  focused_modules: input.strategicPayload.focused_modules ?? [],
                  additional_direction: input.strategicPayload.additional_direction ?? null,
                  execution_config: input.strategicPayload.execution_config ?? null,
                }
              : undefined,
        }
      : undefined;
    const relevance = await getTrendRelevance({
      signals: trendsToScore.map(normalizeTrendInput),
      geo: pickProfileGeo(profile),
      category: pickEffectiveCategory(profile, input.strategicPayload),
      companyProfile: companyProfileForOmnivyra,
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
      category: pickEffectiveCategory(profile, input.strategicPayload),
      companyProfile: companyProfileForOmnivyra,
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
    trendsUsed = scoreByAlignmentThenPopularity(trendsUsed, profile, input.strategicPayload);
    fallbackReason = insightSource === 'api' ? 'insight_source_api' : 'omnivyra_disabled';
    setLastFallbackReason(fallbackReason);
  }

  console.log('[STRATEGIC_TRACE] Final selected topics after ranking', {
    count: trendsUsed.length,
    topics: trendsUsed.map((t) => t.topic),
  });

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
  const polished = polishRecommendations(trendsUsed, profile, input.strategicPayload);
  if (polished.length > 0) {
    trendsUsed = polished as unknown as TrendSignalNormalized[];
  }
  // Intelligence enrichment was removed upstream; this step is now a no-op
  // pass-through (equivalent to the prior empty-result branch). trendsUsed
  // is carried forward unchanged.

  const { getExcludedThemeTopicsForCompany } = await import('../companyThemeStateService');
  const { generateThemeKey } = await import('../themeKeyService');
  const excludedKeys = await getExcludedThemeTopicsForCompany(input.companyId);
  const excludedSet = new Set(excludedKeys);
  trendsUsed = trendsUsed.filter((rec) => {
    const themeKey = generateThemeKey(rec.topic || '');
    return !excludedSet.has(themeKey);
  });

  const MIN_THEME_COUNT = 5;
  if (trendsUsed.length < MIN_THEME_COUNT) {
    const needed = MIN_THEME_COUNT - trendsUsed.length;
    const { generateAdditionalStrategicThemes } = await import('../strategicThemeEngine');
    const rankingContext = {
      historicalThemeCache: new Map<string, Set<string>>(),
    };
    const existingThemeKeys = [
      ...excludedSet,
      ...trendsUsed.map((t) => generateThemeKey(t.topic || '')),
    ];
    const extraThemes = await generateAdditionalStrategicThemes({
      companyId: input.companyId,
      strategicPayload: input.strategicPayload,
      limit: needed * 2,
      existingThemeKeys,
      rankingContext,
    });
    const extraFiltered = extraThemes.filter((t) => {
      const key = generateThemeKey(t.topic);
      return !excludedSet.has(key);
    });
    const fallbackSignals: TrendSignalNormalized[] = extraFiltered.map((t) => ({
      topic: t.topic,
      source: 'ai_generated_fallback',
      sources: ['ai_generated_fallback'],
      frequency: 1,
      volume: 60,
      signal_confidence: 0.6,
      momentum_score: 0.6,
      confidence_score: 0.6,
      evidence:
        t.evidence?.map((e) => ({
          signal: e.signal,
          momentum: e.momentum,
          relevance: e.relevance,
          ...(e.source_type && { source_type: e.source_type }),
          ...(e.trend_direction && { trend_direction: e.trend_direction }),
          ...(e.trend_strength !== undefined && { trend_strength: e.trend_strength }),
          ...(e.signal_age_hours !== undefined && { signal_age_hours: e.signal_age_hours }),
          ...(e.signal_age_label && { signal_age_label: e.signal_age_label }),
        })) ?? undefined,
    }));
    const biased = applyPersonaPlatformBias(fallbackSignals, personaSummary, profile);
    const polished = polishRecommendations(biased, profile, input.strategicPayload);
    const polishedFallback = polished.length > 0 ? (polished as unknown as TrendSignalNormalized[]) : biased;
    // Intelligence enrichment removed upstream; no-op pass-through
    // (equivalent to the prior empty-result branch).
    const processedFallback = polishedFallback;
    trendsUsed = [...trendsUsed, ...processedFallback].slice(0, MIN_THEME_COUNT);
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
  // LLM path populates `tagged` from DB/AI sources — `usedFallbackContextSignals` stays false
  // but themes ARE present, so the unhealthy-API guard must not discard them.
  if (allUnhealthy && !usedFallbackContextSignals && insightSource !== 'llm') {
    const fallbackPlan = await generateCampaignStrategy({
      companyId: input.companyId,
      objective,
      durationWeeks,
    });
    const healthReport = getOmnivyraHealthReport();
    const lastMeta = getLastMeta();
    if (!isOmnivyraEnabled()) {
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
      company_context: companyContext,
      strategy_dna: profile ? buildCompanyStrategyDNA(profile) : undefined,
      strategy_feedback: profile ? analyzeStrategySignals([], buildCompanyStrategyDNA(profile), profile) : undefined,
      omnivyra_status: {
        status: healthReport.status,
        confidence: undefined,
        contract_version: lastMeta?.contract_version,
        latency_ms: lastMeta?.latency_ms,
        fallback_reason: getLastFallbackReason() ?? (isOmnivyraEnabled() ? null : 'omnivyra_disabled'),
        last_error: healthReport.last_error,
        endpoint: lastMeta?.endpoint ?? null,
      },
      global_disclaimer: effectiveRegions.length > 1 ? 'Trend signals vary across selected geographies. Local validation recommended.' : undefined,
      signals_source: 'PROFILE_ONLY' as const,
    } as RecommendationEngineResult;

    if (isOmnivyraEnabled()) {
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

  const healthReport = getOmnivyraHealthReport();
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
    company_context: companyContext,
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

  for (const topic of result.trends_used) {
    if (!topic.signal_id) {
      if (!topic.signal_type) {
        topic.signal_type = 'MANUAL';
      }
      if (!topic.signal_id && topic.signal_type !== 'MANUAL') {
        topic.signal_type = 'EXTERNAL_API';
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[RecommendationEngine] Missing signal_id, using fallback lineage', topic.topic);
      }
    }
    if (!topic.source_topic) topic.source_topic = topic.topic ?? null;
  }

  const executionBlueprint = resolveExecutionBlueprint(result);
  if (executionBlueprint != null) {
    result.execution_blueprint_resolved = executionBlueprint;
    result.execution_source = EXECUTION_SOURCE_VALIDATED;
  }

  if (isOmnivyraEnabled()) {
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

