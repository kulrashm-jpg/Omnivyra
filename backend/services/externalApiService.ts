import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getCachedResponse, setCachedResponse, buildCacheKey, getCacheStats } from './externalApiCacheService';
import { updateApiHealth, getHealthSnapshot } from './externalApiHealthService';
import {
  getTrendRanking,
  getTrendRelevance,
  isOmniVyraEnabled,
  TrendSignalInput,
} from './omnivyraClientV1';

export type ExternalApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
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
  is_enabled: boolean;
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

const rateLimitState = new Map<string, number[]>();
let lastRateLimitedSources: string[] = [];
let lastSignalConfidenceSummary: { average: number; min: number; max: number } | null = null;

const logCacheEvent = (type: 'CACHE_HIT' | 'CACHE_MISS', input: { source: string }) => {
  console.log(type, { source: input.source });
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

const isRateLimited = (rateLimitKey: string, limitPerMin: number): boolean => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entries = rateLimitState.get(rateLimitKey) || [];
  const recent = entries.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limitPerMin) {
    rateLimitState.set(rateLimitKey, recent);
    return true;
  }
  recent.push(now);
  rateLimitState.set(rateLimitKey, recent);
  return false;
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
  if ((normalized === 'api_key' || normalized === 'apiKey') && apiKeyEnvName) {
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
  options?: { queryParams?: Record<string, string | number | null | undefined> }
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
  const runtimeValues = Object.entries(options?.queryParams || {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === 'undefined' || value === null) return acc;
      acc[key] = String(value);
      return acc;
    },
    {}
  );

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

export async function getEnabledApis(): Promise<ExternalApiSource[]> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load external APIs: ${error.message}`);
  }

  return data || [];
}

export async function getUserApiAccess(userId: string): Promise<ExternalApiUserAccess[]> {
  const { data, error } = await supabase
    .from('external_api_user_access')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to load user API access: ${error.message}`);
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
  userId?: string | null
): Promise<ExternalApiAccessConfig[]> {
  const sources = await getEnabledApis();
  if (!userId) return sources;

  const accessRows = await getUserApiAccess(userId);
  if (accessRows.length === 0) {
    return sources;
  }

  const accessMap = accessRows.reduce<Record<string, ExternalApiUserAccess>>((acc, row) => {
    acc[row.api_source_id] = row;
    return acc;
  }, {});

  return sources
    .filter((source) => accessMap[source.id]?.is_enabled)
    .map((source) => mergeSourceWithAccess(source, accessMap[source.id]));
}

export async function logExternalApiUsage(input: {
  apiSourceId: string;
  userId: string;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
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
  } catch (error) {
    console.warn('API usage log failed', { apiSourceId: input.apiSourceId, userId: input.userId });
  }
}

export async function savePlatformConfig(input: Partial<ExternalApiSource>): Promise<ExternalApiSource> {
  const payload = {
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
  };

  const { data, error } = await supabase
    .from('external_api_sources')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to save platform config: ${error.message}`);
  }

  return data;
}

export async function getPlatformConfigs(): Promise<PlatformConfig[]> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load platform configs: ${error.message}`);
  }

  const apiIds = (data || []).map((row: any) => row.id);
  let healthMap: Record<string, ExternalApiHealth> = {};
  if (apiIds.length > 0) {
    const { data: healthData, error: healthError } = await supabase
      .from('external_api_health')
      .select('*')
      .in('api_source_id', apiIds);
    if (!healthError && healthData) {
      healthMap = healthData.reduce((acc: Record<string, ExternalApiHealth>, row: any) => {
        acc[row.api_source_id] = {
          api_source_id: row.api_source_id,
          freshness_score: row.freshness_score ?? 1,
          reliability_score: row.reliability_score ?? 1,
        };
        return acc;
      }, {});
    }
  }

  return (data || []).map((row: any) => ({
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

export async function getPlatformStrategies(): Promise<PlatformStrategy[]> {
  const configs = await getPlatformConfigs();
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
  platform: string
): Promise<PlatformConfig | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
    .or(`category.eq.${platform},name.ilike.%${platform}%`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('Failed to load platform config', { platform });
    return null;
  }

  const record = data?.[0];
  if (!record) return null;

  const health = await getApiHealthByPlatform(platform);
  return {
    ...record,
    health,
  };
}

export function validatePlatformConfig(input: Partial<ExternalApiSource>): {
  ok: boolean;
  message?: string;
} {
  if (!input.name || !input.base_url || !input.platform_type) {
    return { ok: false, message: 'Missing required fields' };
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
  platform: string
): Promise<ExternalApiSource | null> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('*')
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
  platform: string
): Promise<ExternalApiHealth | null> {
  const config = await getApiConfigByPlatform(platform);
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
  geo?: string,
  category?: string,
  options?: { recordHealth?: boolean; minReliability?: number; userId?: string | null }
): Promise<TrendSignal[]> {
  const userId = options?.userId ?? null;
  const usageUserId = userId ?? 'system';
  const sources = await getExternalApiSourcesForUser(userId);
  if (sources.length === 0) return [];

  const results: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
    health_score?: number | null;
  }> = [];
  const recordHealth = options?.recordHealth ?? true;
  const minReliability = options?.minReliability ?? 0;
  lastRateLimitedSources = [];

  for (const source of sources) {
    try {
      const health = await getHealthForSource(source);
      const reliability = health?.reliability_score ?? 1;
      if (reliability < minReliability) {
        console.warn('Skipping external API due to unreliable source', {
          source: source.name,
          reason: 'unreliable source',
        });
        continue;
      }

      const limitPerMin = source.rate_limit_per_min ?? DEFAULT_RATE_LIMIT_PER_MIN;
      const rateLimitKey = `${source.id}:${usageUserId}`;
      if (isRateLimited(rateLimitKey, limitPerMin)) {
        lastRateLimitedSources.push(source.name);
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'rate_limited',
          errorMessage: 'Rate limited',
        });
        continue;
      }

      const request = buildExternalApiRequest(source, {
        queryParams: {
          geo,
          category,
        },
      });
      if (request.missingEnv.length > 0) {
        console.warn('External API env vars missing', { source: source.name });
        if (recordHealth) {
          await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
        }
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: false,
          errorCode: 'missing_env',
          errorMessage: 'Missing API credentials',
        });
        continue;
      }

      const cacheKey = buildCacheKey({ apiId: source.id, geo, category, userId: usageUserId });
      const cached = getCachedResponse<any>(cacheKey, source.id);
      if (cached) {
        logCacheEvent('CACHE_HIT', { source: source.name });
        const healthUpdate = recordHealth
          ? await updateApiHealth({ apiId: source.id, success: true, latencyMs: 0 })
          : null;
        await logExternalApiUsage({
          apiSourceId: source.id,
          userId: usageUserId,
          success: true,
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
        console.warn('External API fetch failed', {
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
        });
        continue;
      }

      const payload = await response.json();
      setCachedResponse(cacheKey, payload, DEFAULT_CACHE_TTL_MS);
      const healthUpdate = recordHealth
        ? await updateApiHealth({ apiId: source.id, success: true, latencyMs })
        : null;
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: true,
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
      console.warn('External API fetch error', { source: source.name });
      if (recordHealth) {
        await updateApiHealth({ apiId: source.id, success: false, latencyMs: 0 });
      }
      await logExternalApiUsage({
        apiSourceId: source.id,
        userId: usageUserId,
        success: false,
        errorCode: 'exception',
        errorMessage: (error as Error)?.message || 'Request failed',
      });
    }
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
    rate_limited_sources: [...lastRateLimitedSources],
    signal_confidence_summary: lastSignalConfidenceSummary,
  };
};

export const resetExternalApiRuntime = () => {
  rateLimitState.clear();
  lastRateLimitedSources = [];
  lastSignalConfidenceSummary = null;
};
