/**
 * internalHelpers.ts
 *
 * Shared private constants and utility helpers used across externalApi sub-modules.
 * NOT re-exported from the externalApiService.ts facade — internal use only.
 */
import { supabase } from '../../db/supabaseClient';
import { isRateLimited as redisIsRateLimited } from '../redisExternalApiCache';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { safeFetch } from '../../../lib/security/safeFetch';
import type { ExternalApiSource } from './types';

// ── Core defaults ─────────────────────────────────────────────────────────────
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_RETRY_COUNT = 2;
export const DEFAULT_RATE_LIMIT_PER_MIN = 60;
export const DEFAULT_CACHE_TTL_MS = 12 * 60 * 1000;

// ── Source reliability weights ────────────────────────────────────────────────
export const sourceReliabilityWeights: Record<string, number> = {
  youtube: 0.95,
  newsapi: 0.75,
  reddit: 0.7,
  serpapi: 0.85,
  google: 0.85,
  omnivyra: 1,
  other: 0.6,
};

// ── Usage ID builders ─────────────────────────────────────────────────────────
export const buildUsageUserId = (userId?: string | null, companyId?: string | null) =>
  `${userId || 'system'}:${companyId || 'global'}`;

export const buildFeatureUsageUserId = (feature: string, companyId: string) =>
  `feature:${feature}|company:${companyId}`;

// ── Profile-based runtime values ──────────────────────────────────────────────
const pickFirst = (values?: string[] | null): string | null => {
  if (!Array.isArray(values)) return null;
  const first = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return first ? first.trim() : null;
};

export const buildProfileRuntimeValues = async (
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const fetchWithTimeoutInit = async (
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
) => {
  // HARDEN-005A: the external-API `base_url` is DB-configurable per source, so
  // this central fetcher (used by execution.ts / singleSourceFetcher.ts for
  // every external-API-source request) now routes through the SSRF-safe layer
  // — validated host, DNS-resolved + pinned, redirects re-validated, size/
  // timeout capped. safeFetch records the same external-latency metrics via
  // recordExternal that the previous observability wrapper did, so metrics
  // continuity is preserved.
  // allowHttp is enabled because some legacy sources are http; the private-IP
  // checks still apply, so http-to-internal is blocked either way.
  return safeFetch(url, init ?? {}, {
    allowHttp: true,
    timeoutMs,
    maxBytes: 25 * 1024 * 1024,
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryResponse = (status: number) => status === 429 || status >= 500;

export const fetchWithRetry = async (
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

// ── Rate limiting ─────────────────────────────────────────────────────────────
export const isRateLimited = async (rateLimitKey: string, limitPerMin: number): Promise<boolean> => {
  return redisIsRateLimited(rateLimitKey, limitPerMin);
};

// ── Signal confidence ─────────────────────────────────────────────────────────
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

export const computeSignalConfidence = (input: {
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

// ── Env / placeholder resolution ──────────────────────────────────────────────
export const resolveEnvValue = (envName?: string | null): string | undefined => {
  if (!envName) return undefined;
  // SECURITY: the literal-key fallback was REMOVED.
  //
  // This previously returned `envName` itself when the value did not look like an
  // environment-variable name — i.e. a secret pasted into the NAME field silently became a
  // working credential. That behaviour is exactly why four live provider keys ended up in
  // `external_api_sources.api_key_env_name` and were served by the catalog API.
  //
  // Retiring it was gated on three checks, all now satisfied:
  //   1. every affected credential was relocated into encrypted account storage;
  //   2. write paths reject secret-shaped input (`isEnvVarName`);
  //   3. read paths redact anything that fails that validation.
  // Callers needing a real secret get it from `resolveAccountCredentials`, which takes
  // precedence over this function at every call site in `execution.ts`.
  //
  // An env-var NAME resolves to its value; anything else resolves to nothing.
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  return undefined;
};

export const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

export const applyOverrides = (
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

// ── Health for source ─────────────────────────────────────────────────────────
export const getHealthForSource = async (
  source: ExternalApiSource,
  /** When provided, query by account_id first; fall back to api_source_id. */
  accountId?: string | null
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    if (accountId) {
      const { data: acctData, error: acctError } = await supabase
        .from('external_api_health')
        .select('freshness_score, reliability_score')
        .eq('account_id', accountId)
        .maybeSingle();
      if (!acctError && acctData) {
        return {
          freshness_score: acctData.freshness_score ?? 1,
          reliability_score: acctData.reliability_score ?? 1,
        };
      }
    }
    const { data, error } = await supabase
      .from('external_api_health')
      .select('freshness_score, reliability_score')
      .eq('api_source_id', source.id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      freshness_score: data.freshness_score ?? 1,
      reliability_score: data.reliability_score ?? 1,
    };
  } catch {
    return null;
  }
};
