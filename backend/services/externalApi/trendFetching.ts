/**
 * trendFetching.ts
 *
 * High-level trend-fetching orchestrators that loop over all accessible API
 * sources for a company and aggregate results into TrendSignal arrays or
 * ExternalApiFetchSummary payloads.
 */
import {
  getCachedResponse,
  setCachedResponse,
  buildCacheKey,
  getCacheStats,
  clearLastRateLimitedSources,
  getLastRateLimitedSources,
  addRateLimitedSource,
} from '../redisExternalApiCache';
import { updateApiHealth } from '../externalApiHealthService';
import { insertFromTrendApiResults } from '../intelligenceSignalStore';
import { getTrendRanking, getTrendRelevance, isOmnivyraEnabled } from '../omnivyraClientV1';
import { resolveAllAccountsForRequest } from '../providerAccountService';
import type {
  ExternalApiSource,
  TrendSignal,
  ExternalApiFetchResult,
  ExternalApiFetchSummary,
} from './types';
import { buildUsageUserId, logExternalApiUsage } from './usageLogging';
import { buildProfileRuntimeValues, DEFAULT_CACHE_TTL_MS, DEFAULT_RATE_LIMIT_PER_MIN, isRateLimited } from './internalHelpers';
import { getExternalApiSourcesForUser } from './userAccess';
import { getHealthForSource } from './dbHelpers';
import { executeWithAccountLoop, buildExternalApiRequest } from './execution';
import {
  normalizeTrendSignals,
  toTrendInput,
  mapOmnivyraTrends,
  applyRankingOrder,
  lastSignalConfidenceSummary,
} from './responseMapping';
import { buildMissingEnvPlaceholders } from './requestValidation';

const logCacheEvent = (type: 'CACHE_HIT' | 'CACHE_MISS', input: { source: string }) => {
  console.log(`EXTERNAL_API_${type}`, { source: input.source });
};

export async function fetchTrendsFromApis(
  companyId?: string | null,
  geo?: string,
  category?: string,
  options?: {
    recordHealth?: boolean;
    minReliability?: number;
    userId?: string | null;
    selectedApiIds?: string[] | null;
    feature?: string | null;
  }
): Promise<TrendSignal[]> {
  const userId = options?.userId ?? null;
  const usageUserId = buildUsageUserId(userId, companyId);
  const selectedApiIds = options?.selectedApiIds;
  if (Array.isArray(selectedApiIds) && selectedApiIds.length === 0) return [];
  const profileRuntimeValues = await buildProfileRuntimeValues(companyId);
  const sources = await getExternalApiSourcesForUser(companyId, userId, selectedApiIds);
  if (sources.length === 0) return [];

  const results: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
    health_score?: number | null;
  }> = [];
  const recordHealth = options?.recordHealth ?? true;
  const minReliability = options?.minReliability ?? 0;
  clearLastRateLimitedSources();

  for (const source of sources) {
    const allAccounts = await resolveAllAccountsForRequest(source.id);
    const primaryAccountId = allAccounts[0]?.id ?? null;
    const health = await getHealthForSource(source, primaryAccountId);
    const reliability = health?.reliability_score ?? 1;
    if (reliability < minReliability) {
      console.warn('EXTERNAL_API_SKIP_UNRELIABLE', { source: source.name });
      continue;
    }

    const rateLimitKey = primaryAccountId
      ? `${primaryAccountId}:${usageUserId}`
      : `src:${source.id}:${usageUserId}`;
    const limitPerMin = source.rate_limit_per_min ?? DEFAULT_RATE_LIMIT_PER_MIN;
    if (await isRateLimited(rateLimitKey, limitPerMin)) {
      addRateLimitedSource(`${source.name}:${primaryAccountId ?? 'default'}`);
      continue;
    }

    const cacheKey = buildCacheKey({ apiId: source.id, geo, category, userId: usageUserId });
    const cached = await getCachedResponse<any>(cacheKey, source.id);
    if (cached) {
      logCacheEvent('CACHE_HIT', { source: source.name });
      const healthUpdate = recordHealth
        ? await updateApiHealth({ apiId: source.id, success: true, latencyMs: 0 })
        : null;
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: true,
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
        accountId: primaryAccountId,
        attempt_number: 1,
        outcome: 'success',
      });
      results.push({
        source,
        payload: cached,
        health,
        health_score: healthUpdate?.health_score ?? null,
      });
      continue;
    }
    logCacheEvent('CACHE_MISS', { source: source.name });

    const loopResult = await executeWithAccountLoop({
      source,
      allAccounts,
      buildRequestFn: (credentials) => buildExternalApiRequest(source, {
        queryParams: { geo, category },
        runtimeValues: profileRuntimeValues,
        accountCredentials: credentials,
      }),
      usageUserId,
      feature: options?.feature ?? null,
      companyId: companyId ?? null,
      recordHealth,
    });

    if (loopResult.success && loopResult.payload !== null) {
      await setCachedResponse(cacheKey, loopResult.payload, DEFAULT_CACHE_TTL_MS);
      results.push({
        source,
        payload: loopResult.payload,
        health: loopResult.health ?? health ?? undefined,
        health_score: loopResult.healthScore,
      });
    }
  }

  if (results.length > 0) {
    void insertFromTrendApiResults(results, companyId ?? null).catch((err) => {
      console.warn('intelligenceSignalStore.insertFromTrendApiResults failed', err?.message ?? err);
    });
  }

  const normalized = normalizeTrendSignals(results);
  if (!isOmnivyraEnabled()) {
    return normalized;
  }

  const relevance = await getTrendRelevance({
    signals: normalized.map(toTrendInput),
    geo,
    category,
  });

  const withRelevance =
    relevance.status === 'ok'
      ? mapOmnivyraTrends(
          relevance.data?.relevant_trends ?? relevance.data?.trends,
          normalized
        )
      : normalized;

  if (relevance.status !== 'ok') {
    console.warn('OMNIVYRA_FALLBACK_TRENDS', { reason: relevance.error?.message });
  }

  const ranking = await getTrendRanking({
    signals: withRelevance.map(toTrendInput),
    geo,
    category,
  });

  if (ranking.status !== 'ok') {
    console.warn('OMNIVYRA_FALLBACK_RANKING', { reason: ranking.error?.message });
    return withRelevance;
  }

  const ordered = applyRankingOrder(
    ranking.data?.ranked_trends ?? ranking.data?.trends,
    withRelevance
  );

  return ordered.map((signal) => ({
    ...signal,
    omnivyra: {
      decision_id: ranking.decision_id,
      confidence: ranking.confidence,
      placeholders: ranking.placeholders,
      explanation: ranking.explanation,
      contract_version: ranking.contract_version,
      partial: ranking.partial,
    },
  }));
}

export async function fetchExternalTrends(
  companyId?: string | null,
  geo?: string,
  category?: string,
  options?: {
    recordHealth?: boolean;
    minReliability?: number;
    userId?: string | null;
    selectedApiIds?: string[] | null;
    feature?: string | null;
    runtimeOverrides?: Record<string, string>;
  }
): Promise<ExternalApiFetchSummary> {
  console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
  if (!companyId) {
    return {
      results: [],
      missing_env_placeholders: [],
      cache_stats: getCacheStats(),
      rate_limited_sources: [],
      signal_confidence_summary: lastSignalConfidenceSummary,
    };
  }
  const userId = options?.userId ?? null;
  const usageUserId = buildUsageUserId(userId, companyId);
  const selectedApiIds = options?.selectedApiIds;
  if (Array.isArray(selectedApiIds) && selectedApiIds.length === 0) {
    return {
      results: [],
      missing_env_placeholders: [],
      cache_stats: getCacheStats(),
      rate_limited_sources: [],
      signal_confidence_summary: lastSignalConfidenceSummary,
    };
  }
  const sources = await getExternalApiSourcesForUser(companyId, userId, selectedApiIds);
  const results: ExternalApiFetchResult[] = [];
  const missingEnv: string[] = [];
  const recordHealth = options?.recordHealth ?? true;
  const minReliability = options?.minReliability ?? 0;
  clearLastRateLimitedSources();

  const profileRuntimeValues = await buildProfileRuntimeValues(companyId);
  const runtimeValues = {
    ...profileRuntimeValues,
    ...(options?.runtimeOverrides && typeof options.runtimeOverrides === 'object' ? options.runtimeOverrides : {}),
  };
  if (typeof geo !== 'undefined' && geo != null) runtimeValues.geo = String(geo);
  if (typeof category !== 'undefined' && category != null) runtimeValues.category = String(category);

  const apiIds = sources.map((source) => source.id);
  console.log('EXTERNAL_API_SOURCES_USED', apiIds);

  for (const source of sources) {
    try {
      const allAccounts = await resolveAllAccountsForRequest(source.id);
      const primaryAccountId = allAccounts[0]?.id ?? null;
      const health = await getHealthForSource(source, primaryAccountId);
      const reliability = health?.reliability_score ?? 1;
      if (reliability < minReliability) {
        console.warn('EXTERNAL_API_SKIP_UNRELIABLE', {
          source: source.name,
          reason: 'unreliable source',
        });
        continue;
      }

      const cacheKey = buildCacheKey({ apiId: source.id, geo, category, userId: usageUserId });
      const cached = await getCachedResponse<any>(cacheKey, source.id);
      if (cached) {
        logCacheEvent('CACHE_HIT', { source: source.name });
        const healthUpdate = recordHealth
          ? await updateApiHealth({ apiId: source.id, success: true, latencyMs: 0 })
          : null;
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: true,
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
          accountId: primaryAccountId,
          attempt_number: 1,
          outcome: 'success',
        });
        results.push({
          source,
          payload: cached,
          health,
          health_score: healthUpdate?.health_score ?? null,
          cache_hit: true,
        });
        continue;
      }
      logCacheEvent('CACHE_MISS', { source: source.name });

      const loopResult = await executeWithAccountLoop({
        source,
        allAccounts,
        buildRequestFn: (credentials) => buildExternalApiRequest(source, {
          queryParams: { geo, category },
          runtimeValues,
          accountCredentials: credentials,
        }),
        usageUserId,
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
        recordHealth,
      });

      if (loopResult.missingEnv.length > 0) missingEnv.push(...loopResult.missingEnv);

      if (loopResult.success && loopResult.payload !== null) {
        await setCachedResponse(cacheKey, loopResult.payload, DEFAULT_CACHE_TTL_MS);
        results.push({
          source,
          payload: loopResult.payload,
          health: loopResult.health ?? health ?? undefined,
          health_score: loopResult.healthScore,
          cache_hit: false,
        });
      } else if (loopResult.missingEnv.length > 0) {
        results.push({
          source,
          payload: null,
          health: loopResult.health ?? health ?? undefined,
          health_score: loopResult.healthScore,
          cache_hit: false,
          missing_env: loopResult.missingEnv,
        });
      }
    } catch (error) {
      console.warn('EXTERNAL_API_FETCH_ERROR', { source: source.name, error: (error as Error)?.message });
    }
  }

  return {
    results,
    missing_env_placeholders: buildMissingEnvPlaceholders(missingEnv),
    cache_stats: getCacheStats(),
    rate_limited_sources: [...getLastRateLimitedSources()],
    signal_confidence_summary: lastSignalConfidenceSummary,
  };
}

export async function fetchExternalApis(
  companyId: string,
  geo?: string,
  category?: string,
  options?: {
    recordHealth?: boolean;
    minReliability?: number;
    userId?: string | null;
    selectedApiIds?: string[] | null;
    feature?: string | null;
    runtimeOverrides?: Record<string, string>;
  }
): Promise<ExternalApiFetchSummary> {
  return fetchExternalTrends(companyId, geo, category, options);
}
