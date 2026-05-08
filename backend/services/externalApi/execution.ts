import { createHash } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { updateApiHealth } from '../externalApiHealthService';
import { logUsageEvent } from '../usageLedgerService';
import { incrementUsageMeter } from '../usageMeterService';
import { checkUsageBeforeExecution } from '../usageEnforcementService';
import {
  addRateLimitedSource,
} from '../redisExternalApiCache';
import {
  resolveAllAccountsForRequest,
  resolveAccountCredentials,
  type ProviderAccount,
} from '../providerAccountService';
import type { ExternalApiSource, ExternalApiRequestDetails, AccountLoopResult } from './types';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RATE_LIMIT_PER_MIN,
  fetchWithRetry,
  isRateLimited,
  resolveEnvValue,
  normalizeRecord,
  applyOverrides,
} from './internalHelpers';
import { logExternalApiUsage } from './usageLogging';
import { ownedDbTable } from '../../db/writeOwner';

const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';

const AUTH_TYPES_REQUIRING_KEY = new Set(['api_key', 'bearer', 'query', 'header']);

const resolveAccessApiKeyEnvName = (
  source: ExternalApiSource,
  access?: { api_key_env_name?: string | null } | null
): string | null => {
  return access?.api_key_env_name ?? source.api_key_env_name ?? source.api_key_name ?? null;
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

const mapHttpErrorMessage = (status: number): string => {
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500) return 'Server error';
  return `HTTP ${status}`;
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

// ── Public API ────────────────────────────────────────────────────────────────

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

export const buildExternalApiRequest = (
  source: ExternalApiSource,
  options?: {
    queryParams?: Record<string, string | number | null | undefined>;
    runtimeValues?: Record<string, string>;
    /** Resolved credentials from an api_provider_accounts row (Phase 1). When
     *  provided, these take precedence over source-level credential fields.
     *  Falls back to existing source fields when null/undefined. */
    accountCredentials?: import('../providerAccountService').ResolvedAccountCredentials | null;
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

  // ── Guard: warn when accountCredentials was not passed for auth-requiring APIs ──
  if (
    options?.accountCredentials === undefined &&
    AUTH_TYPES_REQUIRING_KEY.has(authType)
  ) {
    console.warn('PROVIDER_ACCOUNT_BYPASS', {
      sourceId: source.id,
      sourceName: source.name,
      authType,
      reason: 'accountCredentials not supplied — falling back to source-level credentials',
    });
  }

  // ── Credential resolution: account takes precedence, source is fallback ──
  const acct = options?.accountCredentials ?? null;
  const apiKeyEnvName: string | null =
    acct?.api_key_env_name ?? source.api_key_env_name ?? source.api_key_name ?? null;
  const apiKeyValue: string | undefined =
    acct?.api_key_value ?? resolveEnvValue(apiKeyEnvName);
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

export const recordApiHealth = async (
  source: ExternalApiSource,
  input: { success: boolean; payload?: any }
): Promise<{ freshness_score: number; reliability_score: number } | null> => {
  try {
    const { data, error } = await ownedDbTable('external_api_health')
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

    const { error: upsertError } = await ownedDbTable('external_api_health')
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
      const isSchemaError =
        (upsertError as { code?: string })?.code === 'PGRST205' ||
        (upsertError.message?.toLowerCase().includes('could not find the table') ?? false) ||
        (upsertError.message?.toLowerCase().includes('relation') && upsertError.message?.toLowerCase().includes('does not exist'));
      if (isSchemaError && !(globalThis as any).__external_api_health_schema_hint_shown) {
        (globalThis as any).__external_api_health_schema_hint_shown = true;
        console.warn(
          'external_api_health table not found. Run database/external_api_health.sql to create it. API health tracking will be skipped.'
        );
      } else if (!isSchemaError) {
        console.warn('Failed to persist API health record', {
          source: source.name,
          error: (upsertError as Error)?.message,
          code: (upsertError as { code?: string })?.code,
        });
      }
    }

    return { freshness_score: freshnessScore, reliability_score: reliabilityScore };
  } catch (error) {
    console.warn('API health update failed', { source: source.name });
    return null;
  }
};

// ── Account-switching execution loop ─────────────────────────────────────────

/**
 * Shared inner loop for all external-API execution paths.
 *
 * Iterates accounts in priority order.  Switching rules:
 *  • 429 or Redis rate-limit hit  → continue to next account
 *  • 5xx / network / timeout      → continue to next account
 *  • 4xx (except 429)             → break — client error, don't switch
 *  • success                      → break
 *
 * When allAccounts is empty the loop runs ONCE with credentials = null
 * (legacy source-level fallback path — identical to pre-Phase-2 behavior).
 */
export async function executeWithAccountLoop(input: {
  source: ExternalApiSource;
  allAccounts: ProviderAccount[];
  /**
   * Callback that builds the HTTP request for a given set of credentials.
   * Returns `{ details: null, missingEnv }` to signal a skip-without-request.
   */
  buildRequestFn: (
    credentials: import('../providerAccountService').ResolvedAccountCredentials | null,
    account: ProviderAccount | null,
  ) => { details: ExternalApiRequestDetails | null; missingEnv: string[] };
  usageUserId: string;
  feature: string | null;
  companyId: string | null;
  recordHealth: boolean;
}): Promise<AccountLoopResult> {
  const accountSlots: Array<ProviderAccount | null> =
    input.allAccounts.length > 0 ? input.allAccounts : [null];

  let finalHealth: AccountLoopResult['health'] = null;
  let finalHealthScore: AccountLoopResult['healthScore'] = null;
  const collectedMissingEnv: string[] = [];
  let allRateLimited = true;
  let clientError = false;

  for (let attemptIdx = 0; attemptIdx < accountSlots.length; attemptIdx++) {
    const account = accountSlots[attemptIdx];
    const attemptNumber = attemptIdx + 1;
    const accountId = account?.id ?? null;
    const credentials = account ? resolveAccountCredentials(account) : null;

    const rateLimitKey = accountId
      ? `${accountId}:${input.usageUserId}`
      : `src:${input.source.id}:${input.usageUserId}`;
    const limitPerMin =
      account?.rate_limit_per_min ??
      input.source.rate_limit_per_min ??
      DEFAULT_RATE_LIMIT_PER_MIN;

    if (await isRateLimited(rateLimitKey, limitPerMin)) {
      await logExternalApiUsage({
        apiSourceId: input.source.id,
        userId: input.usageUserId,
        success: false,
        errorCode: 'rate_limited',
        errorMessage: 'Rate limited',
        feature: input.feature,
        companyId: input.companyId,
        accountId,
        attempt_number: attemptNumber,
        outcome: 'rate_limited',
      });
      console.warn('EXTERNAL_API_RATE_LIMITED', {
        source: input.source.name,
        accountId,
        attempt: attemptNumber,
      });
      continue;
    }
    allRateLimited = false;

    const { details, missingEnv } = input.buildRequestFn(credentials, account);
    if (missingEnv.length > 0) collectedMissingEnv.push(...missingEnv);

    if (!details) {
      await logExternalApiUsage({
        apiSourceId: input.source.id,
        userId: input.usageUserId,
        success: false,
        errorCode: 'missing_env',
        errorMessage: 'Missing API credentials for account',
        feature: input.feature,
        companyId: input.companyId,
        accountId,
        attempt_number: attemptNumber,
        outcome: 'missing_env',
      });
      continue;
    }

    const timeoutMs = input.source.timeout_ms ?? DEFAULT_TIMEOUT_MS * 1.6;
    const retryCount = input.source.retry_count ?? DEFAULT_RETRY_COUNT;

    try {
      const startedAt = Date.now();
      const response = await fetchWithRetry(
        details.url,
        { method: details.method, headers: details.headers },
        retryCount,
        timeoutMs,
      );
      const latencyMs = Date.now() - startedAt;

      if (response.status === 429) {
        if (input.recordHealth) {
          const hu = await updateApiHealth({ apiId: input.source.id, success: false, latencyMs, accountId });
          finalHealth = hu ? { freshness_score: hu.freshness_score, reliability_score: hu.reliability_score } : finalHealth;
          finalHealthScore = hu?.health_score ?? finalHealthScore;
        }
        await logExternalApiUsage({
          apiSourceId: input.source.id,
          userId: input.usageUserId,
          success: false,
          errorCode: 'rate_limited',
          errorMessage: 'Rate limited (HTTP 429)',
          feature: input.feature,
          companyId: input.companyId,
          accountId,
          attempt_number: attemptNumber,
          outcome: 'rate_limited',
        });
        addRateLimitedSource(`${input.source.name}:${accountId ?? 'default'}`);
        console.warn('EXTERNAL_API_RATE_LIMITED_HTTP', { source: input.source.name, accountId, attempt: attemptNumber });
        continue;
      }

      if (response.status >= 500) {
        if (input.recordHealth) {
          const hu = await updateApiHealth({ apiId: input.source.id, success: false, latencyMs, accountId });
          finalHealth = hu ? { freshness_score: hu.freshness_score, reliability_score: hu.reliability_score } : finalHealth;
          finalHealthScore = hu?.health_score ?? finalHealthScore;
        }
        await logExternalApiUsage({
          apiSourceId: input.source.id,
          userId: input.usageUserId,
          success: false,
          errorCode: `http_${response.status}`,
          errorMessage: mapHttpErrorMessage(response.status),
          feature: input.feature,
          companyId: input.companyId,
          accountId,
          attempt_number: attemptNumber,
          outcome: 'failed',
        });
        console.warn('EXTERNAL_API_FETCH_FAILED_5XX', { source: input.source.name, status: response.status, accountId, attempt: attemptNumber });
        continue;
      }

      if (!response.ok) {
        // 4xx (not 429) — client error, don't switch accounts
        if (input.recordHealth) {
          const hu = await updateApiHealth({ apiId: input.source.id, success: false, latencyMs, accountId });
          finalHealth = hu ? { freshness_score: hu.freshness_score, reliability_score: hu.reliability_score } : finalHealth;
          finalHealthScore = hu?.health_score ?? finalHealthScore;
        }
        await logExternalApiUsage({
          apiSourceId: input.source.id,
          userId: input.usageUserId,
          success: false,
          errorCode: `http_${response.status}`,
          errorMessage: mapHttpErrorMessage(response.status),
          feature: input.feature,
          companyId: input.companyId,
          accountId,
          attempt_number: attemptNumber,
          outcome: 'client_error',
        });
        console.warn('EXTERNAL_API_CLIENT_ERROR', { source: input.source.name, status: response.status, accountId });
        clientError = true;
        break;
      }

      // ── SUCCESS ─────────────────────────────────────────────────────────
      const payload = await response.json();
      if (input.recordHealth) {
        const hu = await updateApiHealth({ apiId: input.source.id, success: true, latencyMs, accountId });
        finalHealth = hu ? { freshness_score: hu.freshness_score, reliability_score: hu.reliability_score } : null;
        finalHealthScore = hu?.health_score ?? null;
      }
      await logExternalApiUsage({
        apiSourceId: input.source.id,
        userId: input.usageUserId,
        success: true,
        feature: input.feature,
        companyId: input.companyId,
        accountId,
        attempt_number: attemptNumber,
        outcome: 'success',
      });
      return {
        success: true,
        payload,
        accountId,
        exhausted: false,
        clientError: false,
        missingEnv: collectedMissingEnv,
        health: finalHealth,
        healthScore: finalHealthScore,
      };
    } catch (error: any) {
      // Network / timeout — continue to next account
      if (input.recordHealth) {
        await updateApiHealth({ apiId: input.source.id, success: false, latencyMs: 0, accountId });
      }
      await logExternalApiUsage({
        apiSourceId: input.source.id,
        userId: input.usageUserId,
        success: false,
        errorCode: 'exception',
        errorMessage: error?.message ?? 'Request failed',
        feature: input.feature,
        companyId: input.companyId,
        accountId,
        attempt_number: attemptNumber,
        outcome: 'failed',
      });
      console.warn('EXTERNAL_API_FETCH_ERROR', { source: input.source.name, accountId, attempt: attemptNumber, error: error?.message });
    }
  }

  // All accounts exhausted (or a client error stopped early)
  const exhausted = !clientError;
  if (exhausted) {
    const reason = allRateLimited ? 'ALL_ACCOUNTS_RATE_LIMITED' : 'ALL_ACCOUNTS_EXHAUSTED';
    console.warn(reason, {
      source: input.source.name,
      accountCount: input.allAccounts.length,
    });
    if (allRateLimited) addRateLimitedSource(input.source.name);
  }

  return {
    success: false,
    payload: null,
    accountId: null,
    exhausted,
    clientError,
    missingEnv: collectedMissingEnv,
    health: finalHealth,
    healthScore: finalHealthScore,
  };
}
