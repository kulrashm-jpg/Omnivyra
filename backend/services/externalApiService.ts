import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import {
  getCachedResponse,
  setCachedResponse,
  buildCacheKey,
  getCacheStats,
  isRateLimited as redisIsRateLimited,
  addRateLimitedSource,
  getLastRateLimitedSources,
  clearLastRateLimitedSources,
  resetExternalApiRuntime as redisResetExternalApiRuntime,
} from './redisExternalApiCache';
import { updateApiHealth, getHealthSnapshot } from './externalApiHealthService';
import { logUsageEvent } from './usageLedgerService';
import { incrementUsageMeter } from './usageMeterService';
import { checkUsageBeforeExecution } from './usageEnforcementService';

const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';
import {
  getTrendRanking,
  getTrendRelevance,
  isOmniVyraEnabled,
  TrendSignalInput,
} from './omnivyraClientV1';
import { getProfile } from './companyProfileService';
import { insertFromTrendApiResults } from './intelligenceSignalStore';

export type ExternalApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  company_id?: string | null;
  is_active: boolean;
  method?: string | null;
  auth_type: string;
  api_key_name?: string | null;
  api_key_env_name?: string | null;
  headers?: Record<string, any> | null;
  query_params?: Record<string, any> | null;
  is_preset?: boolean | null;
  retry_count?: number | null;
  timeout_ms?: number | null;
  rate_limit_per_min?: number | null;
  platform_type?: string;
  supported_content_types?: string[];
  promotion_modes?: string[];
  required_metadata?: Record<string, any>;
  posting_constraints?: Record<string, any>;
  requires_admin?: boolean;
  created_at: string;
};

export type ExternalApiUserAccess = {
  id: string;
  api_source_id: string;
  user_id: string;
  api_key_env_name?: string | null;
  headers_override?: Record<string, any> | null;
  query_params_override?: Record<string, any> | null;
  rate_limit_per_min?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type ExternalApiAccessConfig = ExternalApiSource & {
  user_access?: ExternalApiUserAccess | null;
};

export type ExternalApiHealth = {
  api_source_id: string;
  freshness_score: number;
  reliability_score: number;
};

export type PlatformConfig = ExternalApiSource & {
  health?: ExternalApiHealth | null;
};

export type PlatformStrategy = {
  platform_type: string;
  supported_content_types: string[];
  supported_promotion_modes: string[];
  required_metadata: string[];
  is_active: boolean;
  health_score: number;
  category?: string | null;
  name?: string;
};

export type ExternalApiFetchResult = {
  source: ExternalApiSource;
  payload: any;
  health?: { freshness_score: number; reliability_score: number } | null;
  health_score?: number | null;
  cache_hit: boolean;
  missing_env?: string[];
};

export type ExternalApiFetchSummary = {
  results: ExternalApiFetchResult[];
  missing_env_placeholders: string[];
  cache_stats: ReturnType<typeof getCacheStats>;
  rate_limited_sources: string[];
  signal_confidence_summary: { average: number; min: number; max: number } | null;
};

export type TrendSignal = {
  topic: string;
  source: string;
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  signal_confidence?: number;
  trend_source_health?: {
    freshness_score: number;
    reliability_score: number;
  };
  omnivyra?: {
    decision_id?: string;
    confidence?: number;
    placeholders?: string[];
    explanation?: string;
    contract_version?: string;
    partial?: boolean;
  };
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const DEFAULT_CACHE_TTL_MS = 12 * 60 * 1000;

const sourceReliabilityWeights: Record<string, number> = {
  youtube: 0.95,
  newsapi: 0.75,
  reddit: 0.7,
  serpapi: 0.85,
  google: 0.85,
  omnivyra: 1,
  other: 0.6,
};

let lastSignalConfidenceSummary: { average: number; min: number; max: number } | null = null;

// External APIs are owned by Virality.
// Community-AI may only consume signals, not configure or govern APIs.
const buildUsageUserId = (userId?: string | null, companyId?: string | null) =>
  `${userId || 'system'}:${companyId || 'global'}`;

const buildCompanyAccessUserId = (companyId: string) => `company:${companyId}`;

/**
 * Single source of truth for API enablement: company_api_configs.enabled.
 * external_api_user_access no longer determines API availability (only user-level overrides).
 * Uses in-memory cache (TTL 5 min); invalidate on config change.
 */
export async function getEnabledApiIdsFromCompanyConfig(
  companyId: string,
  options?: { skipCache?: boolean }
): Promise<string[]> {
  const { getCompanyConfigRows } = await import('./companyApiConfigCache');
  const rows = await getCompanyConfigRows(companyId, options);
  return rows.filter((r) => r.enabled).map((r) => r.api_source_id);
}

const buildFeatureUsageUserId = (feature: string, companyId: string) =>
  `feature:${feature}|company:${companyId}`;

const pickFirst = (values?: string[] | null): string | null => {
  if (!Array.isArray(values)) return null;
  const first = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return first ? first.trim() : null;
};

const buildProfileRuntimeValues = async (
  companyId?: string | null
): Promise<Record<string, string>> => {
  if (!companyId) return {};
  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
    if (!profile) return {};
    const category =
      (profile.category && profile.category.trim()) ||
      pickFirst(profile.category_list) ||
      (profile.industry && profile.industry.trim()) ||
      pickFirst(profile.industry_list) ||
      (profile.name && profile.name.trim()) ||
      null;
    const keywords = [
      ...(profile.category_list || []),
      ...(profile.industry_list || []),
      ...(profile.content_themes_list || []),
      ...(profile.products_services_list || []),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(', ');
    const runtimeValues: Record<string, string> = {};
    if (category) runtimeValues.category = category;
    if (profile.name) runtimeValues.brand = profile.name;
    if (profile.website_url) runtimeValues.website = profile.website_url;
    if (keywords) runtimeValues.keywords = keywords;
    return runtimeValues;
  } catch {
    return {};
  }
};

const parseUsageUserId = (value: string) => {
  if (value.startsWith('feature:')) {
    const parts = value.split('|');
    const feature = parts[0]?.slice('feature:'.length) || null;
    const companyPart = parts.find((part) => part.startsWith('company:'));
    const companyId = companyPart?.slice('company:'.length) || null;
    return { kind: 'feature' as const, feature, companyId, userId: null };
  }
  const idx = value.lastIndexOf(':');
  if (idx > 0 && idx < value.length - 1) {
    return {
      kind: 'user' as const,
      feature: null,
      companyId: value.slice(idx + 1),
      userId: value.slice(0, idx),
    };
  }
  return { kind: 'unknown' as const, feature: null, companyId: null, userId: value };
};

const logCacheEvent = (type: 'CACHE_HIT' | 'CACHE_MISS', input: { source: string }) => {
  console.log(`EXTERNAL_API_${type}`, { source: input.source });
};

const buildMissingEnvPlaceholders = (missingEnv: string[]) =>
  Array.from(new Set(missingEnv)).map((envName) => `missing_env:${envName}`);

export const recordSignalConfidenceSummary = (confidences: number[]) => {
  if (!confidences.length) {
    lastSignalConfidenceSummary = null;
    return;
  }
  const avg = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  lastSignalConfidenceSummary = {
    average: Number(avg.toFixed(3)),
    min: Number(Math.min(...confidences).toFixed(3)),
    max: Number(Math.max(...confidences).toFixed(3)),
  };
};

const fetchWithTimeout = async (url: string, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchWithTimeoutInit = async (
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryResponse = (status: number) => status === 429 || status >= 500;

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  retryCount: number,
  timeoutMs: number
): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetchWithTimeoutInit(url, init, timeoutMs);
      if (!response.ok && shouldRetryResponse(response.status) && attempt < retryCount) {
        const backoff = 500 * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      return response;
    } catch (error: any) {
      lastError = error;
      if (attempt < retryCount) {
        const backoff = 500 * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error('Failed to fetch');
};

export const executeExternalApiRequest = async (input: {
  source: ExternalApiSource;
  request: ExternalApiRequestDetails;
  timeoutMs?: number;
  retryCount?: number;
}): Promise<
  | { response: Response; latencyMs: number }
  | { ok: false; status: 'blocked_plan_limit'; error: { code: string; [k: string]: unknown } }
> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS * 1.6;
  const retryCount = input.retryCount ?? DEFAULT_RETRY_COUNT;
  const startedAt = Date.now();
  const orgId = input.source.company_id ?? UNKNOWN_ORG;
  const sourceName = input.source.name || 'external_api';

  const enforcement = await checkUsageBeforeExecution({
    organization_id: orgId,
    resource_key: 'external_api_calls',
    projected_increment: 1,
  });
  if (!enforcement.allowed) {
    return {
      ok: false,
      status: 'blocked_plan_limit',
      error: { code: 'PLAN_LIMIT_EXCEEDED', ...enforcement },
    };
  }

  try {
    const response = await fetchWithRetry(
      input.request.url,
      { method: input.request.method, headers: input.request.headers },
      retryCount,
      timeoutMs
    );
    const latencyMs = Date.now() - startedAt;
    void logUsageEvent({
      organization_id: orgId,
      campaign_id: null,
      user_id: null,
      source_type: 'external_api',
      provider_name: 'trend_vendor',
      model_name: null,
      model_version: null,
      source_name: sourceName,
      process_type: 'external_api_request',
      latency_ms: latencyMs,
      error_flag: !response.ok,
      error_type: response.ok ? null : `HTTP ${response.status}`,
      total_cost: 0,
      pricing_snapshot: { fixedCost: 0 },
    });
    if (response.ok) {
      void incrementUsageMeter({
        organization_id: orgId,
        source_type: 'external_api',
        total_cost: 0,
      });
    }
    return { response, latencyMs };
  } catch (error: any) {
    const latencyMs = Date.now() - startedAt;
    void logUsageEvent({
      organization_id: orgId,
      campaign_id: null,
      user_id: null,
      source_type: 'external_api',
      provider_name: 'trend_vendor',
      model_name: null,
      model_version: null,
      source_name: sourceName,
      process_type: 'external_api_request',
      latency_ms: latencyMs,
      error_flag: true,
      error_type: error?.message ?? 'unknown',
      pricing_snapshot: null,
    });
    throw error;
  }
};

const isRateLimited = async (rateLimitKey: string, limitPerMin: number): Promise<boolean> => {
  return redisIsRateLimited(rateLimitKey, limitPerMin);
};

const getSourceWeight = (source?: string) => {
  if (!source) return sourceReliabilityWeights.other;
  const normalized = source.toLowerCase();
  if (normalized.includes('youtube')) return sourceReliabilityWeights.youtube;
  if (normalized.includes('news')) return sourceReliabilityWeights.newsapi;
  if (normalized.includes('reddit')) return sourceReliabilityWeights.reddit;
  if (normalized.includes('serp') || normalized.includes('google'))
    return sourceReliabilityWeights.serpapi;
  if (normalized.includes('omnivyra')) return sourceReliabilityWeights.omnivyra;
  return sourceReliabilityWeights.other;
};

const computeSignalConfidence = (input: {
  source: string;
  health_score?: number | null;
  freshness?: number | null;
  reliability?: number | null;
}) => {
  const base = getSourceWeight(input.source);
  const health = input.health_score ?? 1;
  const freshness = input.freshness ?? 1;
  const reliability = input.reliability ?? 1;
  const score = base * health * freshness * reliability;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
};

type ExternalApiRequestDetails = {
  url: string;
  maskedUrl: string;
  method: string;
  headers: Record<string, string>;
  maskedHeaders: Record<string, string>;
  queryParams: Record<string, string>;
};

const AUTH_TYPES_REQUIRING_KEY = new Set(['api_key', 'bearer', 'query', 'header']);

const resolveEnvValue = (envName?: string | null): string | undefined => {
  if (!envName) return undefined;
  return process.env[envName];
};

const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const applyOverrides = (
  base: Record<string, any>,
  overrides?: Record<string, any> | null
): Record<string, any> => {
  if (!overrides || typeof overrides !== 'object') return { ...base };
  const next = { ...base };
  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === 'undefined') return;
    if (value === null) {
      delete next[key];
      return;
    }
    next[key] = value;
  });
  return next;
};

const resolveAccessApiKeyEnvName = (
  source: ExternalApiSource,
  access?: ExternalApiUserAccess | null
): string | null => {
  return access?.api_key_env_name ?? source.api_key_env_name ?? source.api_key_name ?? null;
};

const resolveUsageDate = (date: Date = new Date()): string => date.toISOString().slice(0, 10);

const mapHttpErrorMessage = (status: number): string => {
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500) return 'Server error';
  return `HTTP ${status}`;
};

const extractPlaceholders = (value: string): string[] => {
  const matches = value.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || [];
  return matches.map((match) => match.replace(/[{}]/g, '').trim());
};

const resolvePlaceholderName = (name: string, apiKeyEnvName?: string | null): string => {
  const normalized = name.trim();
  if (
    (normalized === 'api_key' ||
      normalized === 'apiKey' ||
      normalized === 'API_KEY') &&
    apiKeyEnvName
  ) {
    return apiKeyEnvName;
  }
  return normalized;
};

const replacePlaceholders = (
  value: string,
  envResolver: (name: string) => string | undefined,
  maskSecrets: boolean,
  apiKeyEnvName?: string | null,
  runtimeValues?: Record<string, string>
): { value: string; missing: string[] } => {
  const missing: string[] = [];
  const replaced = value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, envName) => {
    const runtimeValue = runtimeValues?.[envName];
    if (typeof runtimeValue !== 'undefined' && runtimeValue !== null) {
      return String(runtimeValue);
    }
    const resolvedName = resolvePlaceholderName(envName, apiKeyEnvName);
    const resolved = envResolver(resolvedName);
    const hasLowercase = /[a-z]/.test(envName);
    const shouldResolveEnv = resolvedName !== envName || !hasLowercase;
    if (!shouldResolveEnv) {
      return match;
    }
    if (!resolved) {
      missing.push(resolvedName);
      return match;
    }
    return maskSecrets ? '****' : resolved;
  });
  return { value: replaced, missing };
};

const resolveRecordPlaceholders = (
  record: Record<string, any>,
  envResolver: (name: string) => string | undefined,
  maskSecrets: boolean,
  apiKeyEnvName?: string | null,
  runtimeValues?: Record<string, string>
): { resolved: Record<string, string>; missing: string[] } => {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  Object.entries(record).forEach(([key, rawValue]) => {
    if (rawValue === null || typeof rawValue === 'undefined') return;
    if (typeof rawValue === 'string') {
      const result = replacePlaceholders(
        rawValue,
        envResolver,
        maskSecrets,
        apiKeyEnvName,
        runtimeValues
      );
      resolved[key] = result.value;
      missing.push(...result.missing);
      return;
    }
    resolved[key] = String(rawValue);
  });
  return { resolved, missing };
};

export const buildExternalApiRequest = (
  source: ExternalApiSource,
  options?: {
    queryParams?: Record<string, string | number | null | undefined>;
    runtimeValues?: Record<string, string>;
  }
): { details: ExternalApiRequestDetails; missingEnv: string[] } => {
  const method = String(source.method || 'GET').toUpperCase();
  const baseUrl = source.base_url;
  const defaultQuery = normalizeRecord(source.query_params);
  const defaultHeaders = normalizeRecord(source.headers);
  const mergedQuery: Record<string, any> = { ...defaultQuery };
  Object.entries(options?.queryParams || {}).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null) return;
    mergedQuery[key] = value;
  });
  const runtimeValuesFromQueryParams = Object.entries(options?.queryParams || {}).reduce<
    Record<string, string>
  >((acc, [key, value]) => {
    if (typeof value === 'undefined' || value === null) return acc;
    acc[key] = String(value);
    return acc;
  }, {});
  const runtimeValues = {
    ...(options?.runtimeValues || {}),
    ...runtimeValuesFromQueryParams,
  };

  const authType = source.auth_type ?? 'none';
  const apiKeyEnvName = source.api_key_env_name ?? source.api_key_name ?? null;
  const apiKeyValue = resolveEnvValue(apiKeyEnvName);
  const missingEnv: string[] = [];

  if (AUTH_TYPES_REQUIRING_KEY.has(authType)) {
    if (!apiKeyEnvName) {
      missingEnv.push('API_KEY_ENV_NAME');
    } else if (!apiKeyValue) {
      missingEnv.push(apiKeyEnvName);
    }
  }

  const queryPlaceholderNames = Object.values(mergedQuery)
    .filter((val) => typeof val === 'string')
    .flatMap((val) => extractPlaceholders(String(val)));
  const headerPlaceholderNames = Object.values(defaultHeaders)
    .filter((val) => typeof val === 'string')
    .flatMap((val) => extractPlaceholders(String(val)));

  const placeholderEnvNames = new Set([...queryPlaceholderNames, ...headerPlaceholderNames]);
  const runtimeKeys = new Set(Object.keys(runtimeValues));
  placeholderEnvNames.forEach((envName) => {
    if (runtimeKeys.has(envName)) return;
    const resolvedName = resolvePlaceholderName(envName, apiKeyEnvName);
    const hasLowercase = /[a-z]/.test(envName);
    const shouldResolveEnv = resolvedName !== envName || !hasLowercase;
    if (!shouldResolveEnv) return;
    if (!resolveEnvValue(resolvedName)) {
      missingEnv.push(resolvedName);
    }
  });

  if (apiKeyValue && (authType === 'api_key' || authType === 'query')) {
    const hasApiKeyParam = Object.values(mergedQuery).some(
      (value) => typeof value === 'string' && value.includes('{{')
    );
    if (!hasApiKeyParam) {
      mergedQuery.apiKey = apiKeyValue;
    }
  }

  const headersWithAuth: Record<string, any> = { ...defaultHeaders };
  if (apiKeyValue && (authType === 'bearer' || authType === 'header')) {
    if (!headersWithAuth.Authorization) {
      headersWithAuth.Authorization = `Bearer ${apiKeyValue}`;
    }
  }

  const resolvedQuery = resolveRecordPlaceholders(
    mergedQuery,
    resolveEnvValue,
    false,
    apiKeyEnvName,
    runtimeValues
  );
  const maskedQuery = resolveRecordPlaceholders(
    mergedQuery,
    resolveEnvValue,
    true,
    apiKeyEnvName,
    runtimeValues
  );
  missingEnv.push(...resolvedQuery.missing);

  const resolvedHeaders = resolveRecordPlaceholders(
    headersWithAuth,
    resolveEnvValue,
    false,
    apiKeyEnvName,
    runtimeValues
  );
  const maskedHeaders = resolveRecordPlaceholders(
    headersWithAuth,
    resolveEnvValue,
    true,
    apiKeyEnvName,
    runtimeValues
  );
  missingEnv.push(...resolvedHeaders.missing);

  const url = new URL(baseUrl);
  Object.entries(resolvedQuery.resolved).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null || value === '') return;
    url.searchParams.set(key, value);
  });

  const maskedUrl = new URL(baseUrl);
  Object.entries(maskedQuery.resolved).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null || value === '') return;
    maskedUrl.searchParams.set(key, value);
  });

  const dedupedMissing = Array.from(new Set(missingEnv));

  return {
    details: {
      url: url.toString(),
      maskedUrl: maskedUrl.toString(),
      method,
      headers: resolvedHeaders.resolved,
      maskedHeaders: maskedHeaders.resolved,
      queryParams: maskedQuery.resolved,
    },
    missingEnv: dedupedMissing,
  };
};

const computeFreshnessScore = (lastSuccessAt?: string | null): number => {
  if (!lastSuccessAt) return 0;
  const last = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(last)) return 0;
  const now = Date.now();
  const diffHours = (now - last) / (1000 * 60 * 60);
  if (diffHours <= 24) return 1;
  const decayWindowHours = 24 * 6;
  const decay = Math.max(0, 1 - (diffHours - 24) / decayWindowHours);
  return Number(decay.toFixed(3));
};

const computeReliabilityScore = (successCount: number, failureCount: number): number => {
  const total = successCount + failureCount;
  if (total === 0) return 1;
  return Number((successCount / total).toFixed(3));
};

const computePayloadHash = (payload: any): string => {
  const raw = JSON.stringify(payload ?? {});
  return createHash('sha256').update(raw).digest('hex');
};

export const recordApiHealth = async (
  source: ExternalApiSource,
  input: { success: boolean; payload?: any }
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    const { data, error } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', source.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Failed to load API health record', { source: source.name });
      return null;
    }

    const nowIso = new Date().toISOString();
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const freshnessScore = computeFreshnessScore(lastSuccessAt);
    const reliabilityScore = computeReliabilityScore(successCount, failureCount);
    const payloadHash = input.success
      ? computePayloadHash(input.payload)
      : data?.last_payload_hash ?? null;

    const { error: upsertError } = await supabase
      .from('external_api_health')
      .upsert(
        {
          api_source_id: source.id,
          last_success_at: lastSuccessAt,
          last_failure_at: lastFailureAt,
          success_count: successCount,
          failure_count: failureCount,
          last_payload_hash: payloadHash,
          freshness_score: freshnessScore,
          reliability_score: reliabilityScore,
        },
        { onConflict: 'api_source_id' }
      );

    if (upsertError) {
      console.warn('Failed to persist API health record', { source: source.name });
    }

    return { freshness_score: freshnessScore, reliability_score: reliabilityScore };
  } catch (error) {
    console.warn('API health update failed', { source: source.name });
    return null;
  }
};

export async function getEnabledApis(companyId?: string | null): Promise<ExternalApiSource[]> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return [];
  }
  const createQuery = () =>
    supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

  const scopedResult = await createQuery().or(`company_id.eq.${companyId},company_id.is.null`);
  const sources: ExternalApiSource[] = scopedResult.error ? [] : (scopedResult.data || []);
  if (scopedResult.error && !scopedResult.error.message?.toLowerCase().includes('company_id')) {
    console.warn('getEnabledApis scoped query failed', { companyId, message: scopedResult.error.message });
    const fallback = await createQuery();
    if (fallback.error) {
      console.warn('getEnabledApis fallback query failed', { companyId, message: fallback.error.message });
      return [];
    }
    sources.push(...(fallback.data || []));
  } else if (scopedResult.error) {
    const fallback = await createQuery();
    if (fallback.error) {
      console.warn('getEnabledApis fallback query failed', { companyId, message: fallback.error.message });
      return [];
    }
    sources.push(...(fallback.data || []));
  }

  const companyScoped = sources.some((row) => Object.prototype.hasOwnProperty.call(row, 'company_id'));
  const companySpecific = companyScoped
    ? sources.filter((row) => row.company_id === companyId)
    : sources.filter((row) => !row.is_preset);
  const globalPresets = sources.filter((row) => row.is_preset && (!companyScoped || !row.company_id));

  const enabledIds = await getEnabledApiIdsFromCompanyConfig(companyId);
  const enabledSet = new Set(enabledIds);
  const selectedPresets = globalPresets.filter((preset) => enabledSet.has(preset.id));
  return [...companySpecific, ...selectedPresets];
}

export async function getAvailableApis(companyId?: string | null): Promise<ExternalApiSource[]> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return [];
  }
  console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
  const baseQuery = () =>
    supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

  const scoped = await baseQuery().or(`company_id.eq.${companyId},company_id.is.null`);
  if (!scoped.error) {
    const companySpecific = (scoped.data || []).filter((row) => row.company_id === companyId);
    const globalPresets = (scoped.data || []).filter((row) => row.is_preset && !row.company_id);
    return [...companySpecific, ...globalPresets];
  }
  const message = scoped.error.message || '';
  if (!message.toLowerCase().includes('company_id')) {
    console.warn('getAvailableApis scoped query failed', { companyId, message });
  }
  const fallback = await baseQuery();
  if (fallback.error) {
    console.warn('getAvailableApis fallback query failed', { companyId, message: fallback.error.message });
    return [];
  }
  const rows = fallback.data || [];
  const companySpecific = rows.filter((row) => row.company_id === companyId);
  const globalPresets = rows.filter((row) => row.is_preset && !row.company_id);
  return [...companySpecific, ...globalPresets];
}

export async function getCompanyDefaultApiIds(companyId: string): Promise<string[]> {
  return getEnabledApiIdsFromCompanyConfig(companyId);
}

export async function getUserApiAccess(userId: string): Promise<ExternalApiUserAccess[]> {
  const { data, error } = await supabase
    .from('external_api_user_access')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.warn('getUserApiAccess failed', { userId, message: error.message });
    return [];
  }

  return data || [];
}

const mergeSourceWithAccess = (
  source: ExternalApiSource,
  access?: ExternalApiUserAccess | null
): ExternalApiAccessConfig => {
  const mergedHeaders = applyOverrides(
    normalizeRecord(source.headers),
    normalizeRecord(access?.headers_override)
  );
  const mergedQuery = applyOverrides(
    normalizeRecord(source.query_params),
    normalizeRecord(access?.query_params_override)
  );

  return {
    ...source,
    api_key_env_name: resolveAccessApiKeyEnvName(source, access),
    headers: mergedHeaders,
    query_params: mergedQuery,
    rate_limit_per_min: access?.rate_limit_per_min ?? source.rate_limit_per_min,
    user_access: access ?? null,
  };
};

export async function getExternalApiSourcesForUser(
  companyId?: string | null,
  userId?: string | null,
  selectedApiIds?: string[] | null
): Promise<ExternalApiAccessConfig[]> {
  const sources = await getEnabledApis(companyId);
  if (!companyId) return [];
  if (!userId) return sources;

  const accessRows = await getUserApiAccess(userId);
  if (accessRows.length === 0) {
    if (Array.isArray(selectedApiIds)) {
      return sources.filter((source) => selectedApiIds.includes(source.id));
    }
    return sources;
  }

  const accessMap = accessRows.reduce<Record<string, ExternalApiUserAccess>>((acc, row) => {
    acc[row.api_source_id] = row;
    return acc;
  }, {});

  const merged = sources.map((source) => mergeSourceWithAccess(source, accessMap[source.id]));
  if (Array.isArray(selectedApiIds)) {
    return merged.filter((source) => selectedApiIds.includes(source.id));
  }
  return merged;
}

export async function logExternalApiUsage(input: {
  apiSourceId: string;
  userId: string;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  feature?: string | null;
  companyId?: string | null;
}): Promise<void> {
  try {
    const usageDate = resolveUsageDate();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('external_api_usage')
      .select('*')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Failed to load API usage record', {
        apiSourceId: input.apiSourceId,
        userId: input.userId,
      });
      return;
    }

    const requestCount = (data?.request_count ?? 0) + 1;
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const lastErrorCode = input.success ? data?.last_error_code ?? null : input.errorCode ?? null;
    const lastErrorMessage = input.success
      ? data?.last_error_message ?? null
      : input.errorMessage ?? null;
    const lastErrorAt = input.success ? data?.last_error_at ?? null : nowIso;
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;

    const { error: upsertError } = await supabase
      .from('external_api_usage')
      .upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: input.userId,
          usage_date: usageDate,
          request_count: requestCount,
          success_count: successCount,
          failure_count: failureCount,
          last_used_at: nowIso,
          last_failure_at: lastFailureAt,
          last_error_code: lastErrorCode,
          last_error_message: lastErrorMessage,
          last_error_at: lastErrorAt,
          last_success_at: lastSuccessAt,
          updated_at: nowIso,
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );

    if (upsertError) {
      console.warn('Failed to update API usage record', {
        apiSourceId: input.apiSourceId,
        userId: input.userId,
      });
    }

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      await supabase.from('external_api_usage').upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: featureUserId,
          usage_date: usageDate,
          request_count: requestCount,
          success_count: successCount,
          failure_count: failureCount,
          last_used_at: nowIso,
          last_failure_at: lastFailureAt,
          last_error_code: lastErrorCode,
          last_error_message: lastErrorMessage,
          last_error_at: lastErrorAt,
          last_success_at: lastSuccessAt,
          updated_at: nowIso,
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );
    }
  } catch (error) {
    console.warn('API usage log failed', { apiSourceId: input.apiSourceId, userId: input.userId });
  }
}

/**
 * Increment signals_generated in external_api_usage (e.g. after inserting into intelligence_signals).
 * Call from intelligence polling worker or any path that inserts signals.
 */
export async function addSignalsGenerated(input: {
  apiSourceId: string;
  userId: string;
  count: number;
  feature?: string | null;
  companyId?: string | null;
}): Promise<void> {
  if (input.count <= 0) return;
  try {
    const usageDate = resolveUsageDate();
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('external_api_usage')
      .select('signals_generated, request_count, success_count, failure_count, last_used_at')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .maybeSingle();

    const current = (data?.signals_generated ?? 0) + input.count;
    const { error: upsertError } = await supabase.from('external_api_usage').upsert(
      {
        api_source_id: input.apiSourceId,
        user_id: input.userId,
        usage_date: usageDate,
        signals_generated: current,
        request_count: data?.request_count ?? 0,
        success_count: data?.success_count ?? 0,
        failure_count: data?.failure_count ?? 0,
        last_used_at: data?.last_used_at ?? nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'api_source_id,user_id,usage_date' }
    );

    if (upsertError) {
      console.warn('Failed to update signals_generated', {
        apiSourceId: input.apiSourceId,
        userId: input.userId,
      });
    }

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      const { data: featureData } = await supabase
        .from('external_api_usage')
        .select('signals_generated, request_count, success_count, failure_count, last_used_at')
        .eq('api_source_id', input.apiSourceId)
        .eq('user_id', featureUserId)
        .eq('usage_date', usageDate)
        .maybeSingle();
      const featureCurrent = (featureData?.signals_generated ?? 0) + input.count;
      await supabase.from('external_api_usage').upsert(
        {
          api_source_id: input.apiSourceId,
          user_id: featureUserId,
          usage_date: usageDate,
          signals_generated: featureCurrent,
          request_count: featureData?.request_count ?? 0,
          success_count: featureData?.success_count ?? 0,
          failure_count: featureData?.failure_count ?? 0,
          last_used_at: featureData?.last_used_at ?? nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );
    }
  } catch (error) {
    console.warn('addSignalsGenerated failed', {
      apiSourceId: input.apiSourceId,
      userId: input.userId,
    });
  }
}

const buildPlatformPayload = (input: Partial<ExternalApiSource>) => ({
  name: input.name,
  base_url: input.base_url,
  purpose: input.purpose,
  category: input.category ?? null,
  is_active: input.is_active ?? true,
  method: input.method ?? 'GET',
  auth_type: input.auth_type ?? 'none',
  api_key_name: input.api_key_name ?? null,
  api_key_env_name: input.api_key_env_name ?? null,
  headers: input.headers ?? {},
  query_params: input.query_params ?? {},
  is_preset: input.is_preset ?? false,
  retry_count: input.retry_count ?? DEFAULT_RETRY_COUNT,
  timeout_ms: input.timeout_ms ?? DEFAULT_TIMEOUT_MS * 1.6,
  rate_limit_per_min: input.rate_limit_per_min ?? DEFAULT_RATE_LIMIT_PER_MIN,
  platform_type: input.platform_type ?? 'social',
  supported_content_types: input.supported_content_types ?? [],
  promotion_modes: input.promotion_modes ?? [],
  required_metadata: input.required_metadata ?? {},
  posting_constraints: input.posting_constraints ?? {},
  requires_admin: input.requires_admin ?? true,
  created_at: input.created_at ?? new Date().toISOString(),
});

export async function savePlatformConfig(input: Partial<ExternalApiSource>): Promise<ExternalApiSource> {
  const basePayload = buildPlatformPayload(input);
  const payloadWithCompany = { ...basePayload, company_id: input.company_id ?? null };

  const sanitizePayload = (payload: Record<string, any>, message: string) => {
    const next = { ...payload };
    const lower = message.toLowerCase();
    if (lower.includes('is_preset')) {
      delete next.is_preset;
    }
    if (lower.includes('company_id')) {
      delete next.company_id;
    }
    return next;
  };

  let initial = await supabase
    .from('external_api_sources')
    .insert(payloadWithCompany)
    .select('*')
    .single();

  if (!initial.error) {
    return initial.data as ExternalApiSource;
  }
  const message = initial.error.message || '';
  const sanitized = sanitizePayload(payloadWithCompany, message);
  if (Object.keys(sanitized).length !== Object.keys(payloadWithCompany).length) {
    initial = await supabase
      .from('external_api_sources')
      .insert(sanitized)
      .select('*')
      .single();
    if (!initial.error) {
      return initial.data as ExternalApiSource;
    }
  }
  if (!message.toLowerCase().includes('company_id')) {
    throw new Error(`Failed to save platform config: ${message}`);
  }

  const fallback = await supabase
    .from('external_api_sources')
    .insert(sanitizePayload(basePayload, message))
    .select('*')
    .single();
  if (fallback.error) {
    throw new Error(`Failed to save platform config: ${fallback.error.message}`);
  }
  return fallback.data as ExternalApiSource;
}

export async function saveTenantPlatformConfig(
  input: Partial<ExternalApiSource> & { company_id: string }
): Promise<ExternalApiSource> {
  if (!input.company_id) {
    throw new Error('company_id is required for tenant-scoped API');
  }
  const payload = { ...buildPlatformPayload(input), company_id: input.company_id };
  let result = await supabase
    .from('external_api_sources')
    .insert(payload)
    .select('*')
    .single();

  if (result.error) {
    const message = result.error.message || '';
    if (message.toLowerCase().includes('is_preset')) {
      const sanitized = { ...payload };
      delete (sanitized as any).is_preset;
      result = await supabase
        .from('external_api_sources')
        .insert(sanitized)
        .select('*')
        .single();
      if (!result.error) {
        return result.data as ExternalApiSource;
      }
    }
    if (message.toLowerCase().includes('company_id')) {
      throw new Error('company_id column missing for tenant-scoped API');
    }
    throw new Error(`Failed to save tenant platform config: ${message}`);
  }
  return result.data as ExternalApiSource;
}

async function fetchHealthMapForApiIds(
  apiIds: string[]
): Promise<Record<string, ExternalApiHealth>> {
  if (apiIds.length === 0) return {};
  const { data: healthData, error: healthError } = await supabase
    .from('external_api_health')
    .select('*')
    .in('api_source_id', apiIds);
  if (healthError || !healthData) return {};
  return healthData.reduce<Record<string, ExternalApiHealth>>((acc, row: any) => {
    acc[row.api_source_id] = {
      api_source_id: row.api_source_id,
      freshness_score: row.freshness_score ?? 1,
      reliability_score: row.reliability_score ?? 1,
    };
    return acc;
  }, {});
}

export async function getPlatformConfigs(
  companyId?: string | null,
  options?: { skipCache?: boolean }
): Promise<PlatformConfig[]> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return [];
  }
  const createQuery = () =>
    supabase
      .from('external_api_sources')
      .select('*')
      .order('created_at', { ascending: true });

  const scopedResult = await createQuery().or(`company_id.eq.${companyId},company_id.is.null`);
  let sources: any[] = scopedResult.error ? [] : (scopedResult.data || []);
  if (scopedResult.error && !scopedResult.error.message?.toLowerCase().includes('company_id')) {
    throw new Error(`Failed to load platform configs: ${scopedResult.error.message}`);
  }
  if (scopedResult.error) {
    const fallbackResult = await createQuery();
    if (fallbackResult.error) throw new Error(`Failed to load platform configs: ${fallbackResult.error.message}`);
    sources = fallbackResult.data || [];
  }

  const companyScoped = sources.some((row: any) => Object.prototype.hasOwnProperty.call(row, 'company_id'));
  const companySpecific = companyScoped
    ? sources.filter((row: any) => row.company_id === companyId)
    : sources.filter((row: any) => !row.is_preset);
  const globalPresets = sources.filter((row: any) => row.is_preset && (!companyScoped || !row.company_id));
  let enabledIds = await getEnabledApiIdsFromCompanyConfig(companyId, options);
  if (enabledIds.length === 0 && (sources.length > 0 || companyId)) {
    enabledIds = await getEnabledApiIdsFromCompanyConfig(companyId, { ...options, skipCache: true });
  }
  const enabledSet = new Set(enabledIds);
  let selectedPresets = globalPresets.filter((preset: any) => enabledSet.has(preset.id));

  if (enabledIds.length > 0 && selectedPresets.length === 0) {
    const { data: enabledSources } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_active', true)
      .in('id', enabledIds);
    const fetched = (enabledSources || []).filter(
      (row: any) => !companySpecific.some((c: any) => c.id === row.id)
    );
    selectedPresets = fetched;
  }

  let data = [...companySpecific, ...selectedPresets];
  if (companyId && data.length === 0 && enabledIds.length > 0) {
    const { data: fallbackSources } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_active', true)
      .in('id', enabledIds);
    data = fallbackSources || [];
  }

  const apiIds = data.map((row: any) => row.id);
  const healthMap = await fetchHealthMapForApiIds(apiIds);

  return data.map((row: any) => ({
    ...row,
    health: healthMap[row.id] || null,
  }));
}

const normalizeArray = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
};

const normalizeRequiredMetadata = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).filter((key) => Boolean(value[key]));
  }
  return [];
};

export async function getPlatformStrategies(companyId?: string | null): Promise<PlatformStrategy[]> {
  const configs = await getPlatformConfigs(companyId);
  return configs.map((config) => {
    const healthScore =
      (config.health?.freshness_score ?? 1) * (config.health?.reliability_score ?? 1);
    return {
      platform_type: config.platform_type || 'social',
      supported_content_types: normalizeArray(config.supported_content_types),
      supported_promotion_modes: normalizeArray(config.promotion_modes),
      required_metadata: normalizeRequiredMetadata(config.required_metadata),
      is_active: config.is_active !== false,
      health_score: Number(healthScore.toFixed(3)),
      category: config.category ?? null,
      name: config.name,
    };
  });
}

export async function getPlatformConfigByPlatform(
  companyId: string | null | undefined,
  platform: string
): Promise<PlatformConfig | null> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return null;
  }
  const createQuery = () =>
    supabase
      .from('external_api_sources')
      .select('*')
      .or(`category.eq.${platform},name.ilike.%${platform}%`)
      .order('created_at', { ascending: true })
      .limit(1);

  const scopedResult = await createQuery().eq('company_id', companyId);
  let record = scopedResult.data?.[0];
  if (scopedResult.error) {
    const message = scopedResult.error.message || '';
    if (!message.toLowerCase().includes('company_id')) {
      console.warn('Failed to load platform config', { platform });
      return null;
    }
    const fallbackResult = await createQuery();
    if (fallbackResult.error) {
      console.warn('Failed to load platform config', { platform });
      return null;
    }
    record = fallbackResult.data?.[0];
  }
  if (!record) return null;

  const health = await getApiHealthByPlatform(companyId, platform);
  return {
    ...record,
    health,
  };
}

export function validatePlatformConfig(input: Partial<ExternalApiSource>): {
  ok: boolean;
  message?: string;
} {
  const missing: string[] = [];
  if (!input.name?.trim()) missing.push('name');
  if (!input.base_url?.trim()) missing.push('base_url');
  if (!input.platform_type?.trim()) missing.push('platform_type');
  if (missing.length > 0) {
    return { ok: false, message: `Missing required fields: ${missing.join(', ')}` };
  }
  if (input.method && !['GET', 'POST'].includes(String(input.method).toUpperCase())) {
    return { ok: false, message: 'method must be GET or POST' };
  }
  if (input.supported_content_types && !Array.isArray(input.supported_content_types)) {
    return { ok: false, message: 'supported_content_types must be an array' };
  }
  if (input.promotion_modes && !Array.isArray(input.promotion_modes)) {
    return { ok: false, message: 'promotion_modes must be an array' };
  }
  if (input.headers && (typeof input.headers !== 'object' || Array.isArray(input.headers))) {
    return { ok: false, message: 'headers must be a JSON object' };
  }
  if (input.query_params && (typeof input.query_params !== 'object' || Array.isArray(input.query_params))) {
    return { ok: false, message: 'query_params must be a JSON object' };
  }
  return { ok: true };
}

const getHealthForSource = async (
  source: ExternalApiSource
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    const { data, error } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', source.id)
      .single();
    if (error && error.code !== 'PGRST116') {
      return null;
    }
    if (!data) return null;
    return {
      freshness_score: data.freshness_score ?? 1,
      reliability_score: data.reliability_score ?? 1,
    };
  } catch (error) {
    return null;
  }
};

export async function getApiConfigByPlatform(
  companyId: string | null | undefined,
  platform: string
): Promise<ExternalApiSource | null> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return null;
  }
  console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('company_id', companyId)
    .or(`category.eq.${platform},name.ilike.%${platform}%`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('Failed to load external API config', { platform });
    return null;
  }

  return data?.[0] ?? null;
}

export async function getApiHealthByPlatform(
  companyId: string | null | undefined,
  platform: string
): Promise<ExternalApiHealth | null> {
  const config = await getApiConfigByPlatform(companyId, platform);
  if (!config) return null;
  const { data, error } = await supabase
    .from('external_api_health')
    .select('*')
    .eq('api_source_id', config.id)
    .single();
  if (error && error.code !== 'PGRST116') {
    return null;
  }
  if (!data) return null;
  return {
    api_source_id: data.api_source_id,
    freshness_score: data.freshness_score ?? 1,
    reliability_score: data.reliability_score ?? 1,
  };
}

export function normalizeTrendSignals(
  rawApiResults: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
    health_score?: number | null;
  }>
): TrendSignal[] {
  const signals: TrendSignal[] = [];

  rawApiResults.forEach(({ source, payload, health, health_score }) => {
    if (!payload) return;

    const items = Array.isArray(payload?.items) ? payload.items : [];
    items.forEach((item: any) => {
      if (!item?.topic) return;
      const freshness = health?.freshness_score ?? 1;
      const reliability = health?.reliability_score ?? 1;
      signals.push({
        topic: item.topic,
        source: source.name,
        geo: item.geo,
        velocity: item.velocity,
        sentiment: item.sentiment,
        volume: item.volume,
        trend_source_health: health ?? undefined,
        signal_confidence: computeSignalConfidence({
          source: source.name,
          health_score: health_score ?? 1,
          freshness,
          reliability,
        }),
      });
    });
  });

  if (signals.length > 0) {
    const confidences = signals
      .map((signal) => signal.signal_confidence ?? 0)
      .filter((value) => Number.isFinite(value));
    if (confidences.length > 0) {
      const avg = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
      lastSignalConfidenceSummary = {
        average: Number(avg.toFixed(3)),
        min: Number(Math.min(...confidences).toFixed(3)),
        max: Number(Math.max(...confidences).toFixed(3)),
      };
    }
  }

  return signals;
}

const toTrendInput = (signal: TrendSignal): TrendSignalInput => ({
  topic: signal.topic,
  source: signal.source,
  geo: signal.geo,
  velocity: signal.velocity,
  sentiment: signal.sentiment,
  volume: signal.volume,
});

const mapOmniVyraTrends = (
  omnivyraTrends: Array<TrendSignalInput | { topic: string } | string> | undefined,
  fallbackSignals: TrendSignal[]
): TrendSignal[] => {
  if (!omnivyraTrends || omnivyraTrends.length === 0) return fallbackSignals;
  const byTopic = new Map<string, TrendSignal>();
  fallbackSignals.forEach((signal) => {
    byTopic.set(signal.topic.toLowerCase(), signal);
  });
  return omnivyraTrends
    .map((trend) => {
      const topic =
        typeof trend === 'string' ? trend : (trend as any)?.topic ?? (trend as any)?.title;
      if (!topic) return null;
      const match = byTopic.get(String(topic).toLowerCase());
      if (match) {
        return match;
      }
      return {
        topic: String(topic),
        source: (trend as any)?.source || 'omnivyra',
        geo: (trend as any)?.geo,
        velocity: (trend as any)?.velocity,
        sentiment: (trend as any)?.sentiment,
        volume: (trend as any)?.volume,
      } as TrendSignal;
    })
    .filter(Boolean) as TrendSignal[];
};

const applyRankingOrder = (
  ranking: Array<any> | undefined,
  signals: TrendSignal[]
): TrendSignal[] => {
  if (!ranking || ranking.length === 0) return signals;
  const byTopic = new Map<string, TrendSignal>();
  signals.forEach((signal) => byTopic.set(signal.topic.toLowerCase(), signal));
  const ordered = ranking
    .map((trend) => {
      const topic =
        typeof trend === 'string' ? trend : (trend as any)?.topic ?? (trend as any)?.title;
      if (!topic) return null;
      return byTopic.get(String(topic).toLowerCase()) ?? null;
    })
    .filter(Boolean) as TrendSignal[];
  return ordered.length > 0 ? ordered : signals;
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
    try {
      const health = await getHealthForSource(source);
      const reliability = health?.reliability_score ?? 1;
      if (reliability < minReliability) {
        console.warn('EXTERNAL_API_SKIP_UNRELIABLE', {
          source: source.name,
          reason: 'unreliable source',
        });
        continue;
      }

      const limitPerMin = source.rate_limit_per_min ?? DEFAULT_RATE_LIMIT_PER_MIN;
      const rateLimitKey = `${source.id}:${usageUserId}`;
      if (await isRateLimited(rateLimitKey, limitPerMin)) {
        addRateLimitedSource(source.name);
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'rate_limited',
          errorMessage: 'Rate limited',
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
        });
        console.warn('EXTERNAL_API_RATE_LIMITED', { source: source.name });
        continue;
      }

      const request = buildExternalApiRequest(source, {
        queryParams: {
          geo,
          category,
        },
        runtimeValues: profileRuntimeValues,
      });
      if (request.missingEnv.length > 0) {
        console.warn('EXTERNAL_API_MISSING_ENV', {
          source: source.name,
          missing: request.missingEnv,
        });
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'missing_env',
          errorMessage: 'Missing API credentials',
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
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
        console.warn('EXTERNAL_API_FETCH_FAILED', {
          source: source.name,
          status: response.status,
        });
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: `http_${response.status}`,
          errorMessage: mapHttpErrorMessage(response.status),
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
        });
        continue;
      }

      const payload = await response.json();
      await setCachedResponse(cacheKey, payload, DEFAULT_CACHE_TTL_MS);
      const healthUpdate = recordHealth
        ? await updateApiHealth({ apiId: source.id, success: true, latencyMs })
        : null;
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: true,
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
      });
      results.push({
        source,
        payload,
        health: healthUpdate
          ? { freshness_score: healthUpdate.freshness_score, reliability_score: healthUpdate.reliability_score }
          : health ?? undefined,
        health_score: healthUpdate?.health_score ?? null,
      });
    } catch (error) {
      console.warn('EXTERNAL_API_FETCH_ERROR', { source: source.name });
      if (recordHealth) {
        await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
      }
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: false,
        errorCode: 'exception',
        errorMessage: (error as Error)?.message || 'Request failed',
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
      });
    }
  }

  // Optional: persist to unified intelligence signal store (fire-and-forget)
  if (results.length > 0) {
    void insertFromTrendApiResults(results, companyId ?? null).catch((err) => {
      console.warn('intelligenceSignalStore.insertFromTrendApiResults failed', err?.message ?? err);
    });
  }

  const normalized = normalizeTrendSignals(results);
  if (!isOmniVyraEnabled()) {
    return normalized;
  }

  const relevance = await getTrendRelevance({
    signals: normalized.map(toTrendInput),
    geo,
    category,
  });

  const withRelevance =
    relevance.status === 'ok'
      ? mapOmniVyraTrends(
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
    /** Override or extend profile-derived values (e.g. geo, category, keywords). Used for company profile now and user inputs later. */
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
      const health = await getHealthForSource(source);
      const reliability = health?.reliability_score ?? 1;
      if (reliability < minReliability) {
        console.warn('EXTERNAL_API_SKIP_UNRELIABLE', {
          source: source.name,
          reason: 'unreliable source',
        });
        continue;
      }

      const limitPerMin = source.rate_limit_per_min ?? DEFAULT_RATE_LIMIT_PER_MIN;
      const rateLimitKey = `${source.id}:${usageUserId}`;
      if (await isRateLimited(rateLimitKey, limitPerMin)) {
        addRateLimitedSource(source.name);
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'rate_limited',
          errorMessage: 'Rate limited',
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
        });
        console.warn('EXTERNAL_API_RATE_LIMITED', { source: source.name });
        continue;
      }

      const request = buildExternalApiRequest(source, {
        queryParams: {
          geo,
          category,
        },
        runtimeValues,
      });
      if (request.missingEnv.length > 0) {
        missingEnv.push(...request.missingEnv);
        console.warn('EXTERNAL_API_MISSING_ENV', {
          source: source.name,
          missing: request.missingEnv,
        });
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'missing_env',
          errorMessage: 'Missing API credentials',
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
        });
        results.push({
          source,
          payload: null,
          health,
          health_score: null,
          cache_hit: false,
          missing_env: request.missingEnv,
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
        console.warn('EXTERNAL_API_FETCH_FAILED', {
          source: source.name,
          status: response.status,
        });
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: `http_${response.status}`,
          errorMessage: mapHttpErrorMessage(response.status),
          feature: options?.feature ?? null,
          companyId: companyId ?? null,
        });
        continue;
      }

      const payload = await response.json();
      await setCachedResponse(cacheKey, payload, DEFAULT_CACHE_TTL_MS);
      const healthUpdate = recordHealth
        ? await updateApiHealth({ apiId: source.id, success: true, latencyMs })
        : null;
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: true,
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
      });
      results.push({
        source,
        payload,
        health: healthUpdate
          ? { freshness_score: healthUpdate.freshness_score, reliability_score: healthUpdate.reliability_score }
          : health ?? undefined,
        health_score: healthUpdate?.health_score ?? null,
        cache_hit: false,
      });
    } catch (error) {
      console.warn('EXTERNAL_API_FETCH_ERROR', { source: source.name });
      if (recordHealth) {
        await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
      }
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: false,
        errorCode: 'exception',
        errorMessage: (error as Error)?.message || 'Request failed',
        feature: options?.feature ?? null,
        companyId: companyId ?? null,
      });
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
    /** Override profile-derived values; use for user inputs (e.g. user-selected geo, category, keywords). */
    runtimeOverrides?: Record<string, string>;
  }
): Promise<ExternalApiFetchSummary> {
  return fetchExternalTrends(companyId, geo, category, options);
}

/** User id used for usage/health when intelligence polling worker runs (no real user). */
export const INTELLIGENCE_POLLER_USER_ID = 'intelligence-polling';

/**
 * Check company_api_configs daily_limit and signal_limit for a company+source.
 * Used by intelligence polling worker when companyId is set (per-company jobs).
 * Returns { allowed: false, reason } when over limit so the worker can skip fetch/insert.
 */
export async function checkCompanyApiLimitsForPolling(
  companyId: string,
  apiSourceId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: configRow, error: configErr } = await supabase
    .from('company_api_configs')
    .select('daily_limit, signal_limit')
    .eq('company_id', companyId)
    .eq('api_source_id', apiSourceId)
    .eq('enabled', true)
    .maybeSingle();

  if (configErr || !configRow) return { allowed: true };
  const dailyLimit = (configRow as { daily_limit?: number | null }).daily_limit;
  const signalLimit = (configRow as { signal_limit?: number | null }).signal_limit;
  if (dailyLimit == null && signalLimit == null) return { allowed: true };

  const today = new Date().toISOString().slice(0, 10);
  const featureUserId = buildFeatureUsageUserId('intelligence_polling', companyId);
  const { data: usageRow } = await supabase
    .from('external_api_usage')
    .select('request_count, signals_generated')
    .eq('api_source_id', apiSourceId)
    .eq('user_id', featureUserId)
    .eq('usage_date', today)
    .maybeSingle();

  const requests = (usageRow as { request_count?: number } | null)?.request_count ?? 0;
  const signals = (usageRow as { signals_generated?: number } | null)?.signals_generated ?? 0;
  if (dailyLimit != null && requests >= dailyLimit) {
    return { allowed: false, reason: `daily_limit (${requests}/${dailyLimit})` };
  }
  if (signalLimit != null && signals >= signalLimit) {
    return { allowed: false, reason: `signal_limit (${signals}/${signalLimit})` };
  }
  return { allowed: true };
}

/**
 * Load a single external API source by id (for intelligence polling).
 * Returns only if is_active = true; no company filter.
 */
export async function getExternalApiSourceById(
  apiSourceId: string
): Promise<ExternalApiSource | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('id', apiSourceId)
    .eq('is_active', true)
    .single();
  if (error || !data) return null;
  return data as ExternalApiSource;
}

export type FetchSingleSourceResult = {
  results: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
  }>;
  queryHash?: string | null;
  queryContext?: {
    topic?: string | null;
    competitor?: string | null;
    product?: string | null;
    region?: string | null;
    keyword?: string | null;
  } | null;
};

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

  const { expand } = await import('./intelligenceQueryBuilder');
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

  const health = await getHealthForSource(source);
  const request = buildExternalApiRequest(source, {
    queryParams: expanded.queryParams,
    runtimeValues: { ...profileRuntimeValues, ...expanded.runtimeValues },
  });

  if (request.missingEnv.length > 0) {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: false,
      errorCode: 'missing_env',
      errorMessage: 'Missing API credentials',
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });
    return { results: [] };
  }

  const timeoutMs = source.timeout_ms ?? DEFAULT_TIMEOUT_MS * 1.6;
  const retryCount = source.retry_count ?? DEFAULT_RETRY_COUNT;

  try {
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
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: INTELLIGENCE_POLLER_USER_ID,
        success: false,
        errorCode: `http_${response.status}`,
        errorMessage: mapHttpErrorMessage(response.status),
        feature: 'intelligence_polling',
        companyId: companyId ?? null,
      });
      return { results: [] };
    }

    const payload = await response.json();
    const healthUpdate = await updateApiHealth({ apiId: source.id, success: true, latencyMs });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: true,
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });

    return {
      results: [
        {
          source,
          payload,
          health: healthUpdate
            ? {
                freshness_score: healthUpdate.freshness_score,
                reliability_score: healthUpdate.reliability_score,
              }
            : health ?? undefined,
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
  } catch (error: any) {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: false,
      errorCode: 'exception',
      errorMessage: error?.message ?? 'Request failed',
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });
    throw error;
  }
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
  const health = await getHealthForSource(source);
  const request = buildExternalApiRequest(source, {
    queryParams: { geo: undefined, category: undefined },
    runtimeValues: profileRuntimeValues,
  });

  if (request.missingEnv.length > 0) {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: false,
      errorCode: 'missing_env',
      errorMessage: 'Missing API credentials',
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });
    return [];
  }

  const timeoutMs = source.timeout_ms ?? DEFAULT_TIMEOUT_MS * 1.6;
  const retryCount = source.retry_count ?? DEFAULT_RETRY_COUNT;

  try {
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
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: INTELLIGENCE_POLLER_USER_ID,
        success: false,
        errorCode: `http_${response.status}`,
        errorMessage: mapHttpErrorMessage(response.status),
        feature: 'intelligence_polling',
        companyId: companyId ?? null,
      });
      return [];
    }

    const payload = await response.json();
    const healthUpdate = await updateApiHealth({ apiId: source.id, success: true, latencyMs });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: true,
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });

    return [
      {
        source,
        payload,
        health: healthUpdate
          ? { freshness_score: healthUpdate.freshness_score, reliability_score: healthUpdate.reliability_score }
          : health ?? undefined,
      },
    ];
  } catch (error: any) {
    await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
    await logExternalApiUsage({
      apiSourceId: source.id,
      userId: INTELLIGENCE_POLLER_USER_ID,
      success: false,
      errorCode: 'exception',
      errorMessage: error?.message ?? 'Request failed',
      feature: 'intelligence_polling',
      companyId: companyId ?? null,
    });
    throw error;
  }
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
  } catch (error) {
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
  lastSignalConfidenceSummary = null;
};
