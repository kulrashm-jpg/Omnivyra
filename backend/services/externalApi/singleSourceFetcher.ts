/**
 * singleSourceFetcher.ts
 *
 * Single-source fetch helpers used by the intelligence polling pipeline, plus
 * runtime snapshot / reset utilities.
 */
import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { updateApiHealth, getHealthSnapshot } from '../externalApiHealthService';
import {
  getCacheStats,
  getLastRateLimitedSources,
  resetExternalApiRuntime as redisResetExternalApiRuntime,
} from '../redisExternalApiCache';
import { resolveAllAccountsForRequest } from '../providerAccountService';
import type { ExternalApiSource, FetchSingleSourceResult } from './types';
import { buildProfileRuntimeValues, fetchWithRetry } from './internalHelpers';
import { DEFAULT_TIMEOUT_MS, DEFAULT_RETRY_COUNT } from './requestValidation';
import { getExternalApiSourceById } from './userAccess';
import { getHealthForSource } from './dbHelpers';
import { executeWithAccountLoop, buildExternalApiRequest } from './execution';
import { lastSignalConfidenceSummary, resetSignalConfidenceSummary } from './responseMapping';

/** User id used for usage/health when intelligence polling worker runs (no real user). */
export const INTELLIGENCE_POLLER_USER_ID = 'intelligence-polling';

/**
 * Build intelligence-specific source/param overrides for YouTube and NewsAPI.
 * Returns { effectiveSource, effectiveQueryParams } or null if API key missing (skip source).
 */
function getIntelligenceApiOverrides(
  source: ExternalApiSource,
  expanded: { queryParams: Record<string, string>; runtimeValues: Record<string, string> },
  apiKeyValue?: string | null,
): { effectiveSource: ExternalApiSource; effectiveQueryParams: Record<string, string> } | null {
  const name = (source.name || '').toLowerCase();
  const q = expanded.queryParams?.q || expanded.runtimeValues?.topic || 'AI';

  if (name.includes('youtube')) {
    const key = apiKeyValue ?? process.env.YOUTUBE_API_KEY ?? '';
    if (!key.trim()) {
      console.log('[intelligence] API skipped — missing key', { source: source.name, key: 'YOUTUBE_API_KEY' });
      return null;
    }
    return {
      effectiveSource: {
        ...source,
        base_url: 'https://www.googleapis.com/youtube/v3/search',
        auth_type: 'query',
        api_key_env_name: 'YOUTUBE_API_KEY',
      },
      effectiveQueryParams: {
        part: 'snippet',
        type: 'video',
        q,
        maxResults: '25',
        key,
      },
    };
  }

  if (name.includes('news')) {
    const key = apiKeyValue ?? process.env.NEWS_API_KEY ?? '';
    if (!key.trim()) {
      console.log('[intelligence] API skipped — missing key', { source: source.name, key: 'NEWS_API_KEY' });
      return null;
    }
    return {
      effectiveSource: {
        ...source,
        base_url: 'https://newsapi.org/v2/everything',
        auth_type: 'query',
        api_key_env_name: 'NEWS_API_KEY',
      },
      effectiveQueryParams: {
        q,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: '20',
        apiKey: key,
      },
    };
  }

  return { effectiveSource: source, effectiveQueryParams: expanded.queryParams || {} };
}

/**
 * Fetch a single source with query builder expansion (Phase 1).
 * Used by intelligence polling worker. Runs query builder, builds request, fetches.
 */
export async function fetchSingleSourceWithQueryBuilder(
  apiSourceId: string,
  companyId?: string | null
): Promise<FetchSingleSourceResult> {
  const source = await getExternalApiSourceById(apiSourceId);
  if (!source) return { results: [] };

  const { expand } = await import('../intelligenceQueryBuilder');
  const profileRuntimeValues = companyId
    ? await buildProfileRuntimeValues(companyId)
    : {};
  const expanded = await expand({
    source,
    companyId: companyId ?? null,
    topic: profileRuntimeValues.topic ?? profileRuntimeValues.category ?? undefined,
    competitor: profileRuntimeValues.competitor,
    product: profileRuntimeValues.product,
    region: profileRuntimeValues.region ?? profileRuntimeValues.geo,
    keyword: profileRuntimeValues.keywords ?? profileRuntimeValues.keyword,
  });

  const allAccounts = await resolveAllAccountsForRequest(source.id);
  const primaryAccountId = allAccounts[0]?.id ?? null;
  const health = await getHealthForSource(source, primaryAccountId);

  const loopResult = await executeWithAccountLoop({
    source,
    allAccounts,
    buildRequestFn: (credentials, _account) => {
      const overrides = getIntelligenceApiOverrides(source, expanded, credentials?.api_key_value ?? null);
      if (overrides === null) {
        return { details: null, missingEnv: [`intelligence_key_missing:${source.name}`] };
      }
      const { effectiveSource, effectiveQueryParams } = overrides;
      return buildExternalApiRequest(effectiveSource, {
        queryParams: effectiveQueryParams,
        runtimeValues: { ...profileRuntimeValues, ...expanded.runtimeValues },
        accountCredentials: credentials,
      });
    },
    usageUserId: INTELLIGENCE_POLLER_USER_ID,
    feature: 'intelligence_polling',
    companyId: companyId ?? null,
    recordHealth: true,
  });

  if (!loopResult.success) return { results: [] };

  const payload = loopResult.payload;
  const itemsCount = Array.isArray(payload?.items) ? payload.items.length : 0;
  const articlesCount = Array.isArray(payload?.articles) ? payload.articles.length : 0;
  const hasData = itemsCount > 0 || articlesCount > 0 ||
    (Array.isArray(payload?.data?.children) && payload.data.children.length > 0) ||
    (Array.isArray(payload?.trend_results) && payload.trend_results.length > 0) ||
    (Array.isArray(payload?.results) && payload.results.length > 0);
  console.log('[intelligence] raw API response size', {
    source: source.name,
    sourceId: source.id,
    keys: Object.keys(payload ?? {}).slice(0, 12),
    items: itemsCount,
    articles: articlesCount,
    size: JSON.stringify(payload ?? {}).length,
  });
  if (!hasData) {
    console.log('[intelligence] API returned no results', { reason: 'empty_payload', sourceId: source.id });
  }

  return {
    results: [
      {
        source,
        payload,
        health: loopResult.health ?? health ?? undefined,
      },
    ],
    queryHash: expanded.queryHash,
    queryContext: {
      topic: expanded.runtimeValues.topic || null,
      competitor: expanded.runtimeValues.competitor || null,
      product: expanded.runtimeValues.product || null,
      region: expanded.runtimeValues.region || null,
      keyword: expanded.runtimeValues.keyword || null,
    },
  };
}

/**
 * Fetch a single source for the intelligence polling pipeline.
 * Updates health and usage under INTELLIGENCE_POLLER_USER_ID.
 * Returns results array suitable for insertFromTrendApiResults (0 or 1 element).
 */
export async function fetchSingleSourceForIntelligencePolling(
  apiSourceId: string,
  companyId?: string | null
): Promise<
  Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
  }>
> {
  const source = await getExternalApiSourceById(apiSourceId);
  if (!source) return [];

  const profileRuntimeValues = companyId
    ? await buildProfileRuntimeValues(companyId)
    : {};
  const allAccounts = await resolveAllAccountsForRequest(source.id);
  const primaryAccountId = allAccounts[0]?.id ?? null;
  const health = await getHealthForSource(source, primaryAccountId);

  const loopResult = await executeWithAccountLoop({
    source,
    allAccounts,
    buildRequestFn: (credentials) => buildExternalApiRequest(source, {
      queryParams: { geo: undefined, category: undefined },
      runtimeValues: profileRuntimeValues,
      accountCredentials: credentials,
    }),
    usageUserId: INTELLIGENCE_POLLER_USER_ID,
    feature: 'intelligence_polling',
    companyId: companyId ?? null,
    recordHealth: true,
  });

  if (!loopResult.success) return [];

  return [
    {
      source,
      payload: loopResult.payload,
      health: loopResult.health ?? health ?? undefined,
    },
  ];
}

export async function validateExternalApiSource(
  sourceId: string
): Promise<{ freshness_score: number; reliability_score: number } | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('id', sourceId)
    .single();
  if (error || !data) {
    throw new Error('API source not found');
  }
  const source = data as ExternalApiSource;
  const request = buildExternalApiRequest(source);
  if (request.missingEnv.length > 0) {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    return { freshness_score: 0, reliability_score: 0 };
  }

  try {
    const timeoutMs = source.timeout_ms ?? DEFAULT_TIMEOUT_MS * 1.6;
    const retryCount = source.retry_count ?? DEFAULT_RETRY_COUNT;
    const startedAt = Date.now();
    const response = await fetchWithRetry(
      request.details.url,
      { method: request.details.method, headers: request.details.headers },
      retryCount,
      timeoutMs
    );
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      await updateApiHealth({ apiId: source.id, success: false, latencyMs });
      return { freshness_score: 0, reliability_score: 0 };
    }
    const healthUpdate = await updateApiHealth({ apiId: source.id, success: true, latencyMs });
    return {
      freshness_score: healthUpdate?.freshness_score ?? 1,
      reliability_score: healthUpdate?.reliability_score ?? 1,
    };
  } catch {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    return { freshness_score: 0, reliability_score: 0 };
  }
}

export const getExternalApiRuntimeSnapshot = async (apiIds: string[]) => {
  const health = await getHealthSnapshot(apiIds);
  return {
    health_snapshot: health,
    cache_stats: getCacheStats(),
    rate_limited_sources: [...getLastRateLimitedSources()],
    signal_confidence_summary: lastSignalConfidenceSummary,
  };
};

export const resetExternalApiRuntime = async () => {
  await redisResetExternalApiRuntime();
  resetSignalConfidenceSummary();
};
