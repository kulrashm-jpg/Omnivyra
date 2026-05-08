import { createHash } from 'crypto';

import type {
  ExternalApiSource,
  ExternalApiUserAccess,
  ExternalApiHealth,
  PlatformConfig,
} from './types';
import { isApiSourceExecutable, getEnabledApiIdsFromCompanyConfig } from './accessChecks';
import { computeFreshnessScore, computeReliabilityScore } from './responseMapping';
import { normalizeRecord } from './requestValidation';
import { DEFAULT_RETRY_COUNT, DEFAULT_TIMEOUT_MS, DEFAULT_RATE_LIMIT_PER_MIN } from './requestValidation';
import { ownedDbTable } from '../../db/writeOwner';

// ── Usage ID builders ─────────────────────────────────────────────────────────
export const buildUsageUserId = (userId?: string | null, companyId?: string | null) =>
  `${userId || 'system'}:${companyId || 'global'}`;

export const buildFeatureUsageUserId = (feature: string, companyId: string) =>
  `feature:${feature}|company:${companyId}`;

export const resolveUsageDate = (date: Date = new Date()): string => date.toISOString().slice(0, 10);

// ── Health helpers ────────────────────────────────────────────────────────────
const computePayloadHash = (payload: any): string => {
  const raw = JSON.stringify(payload ?? {});
  return createHash('sha256').update(raw).digest('hex');
};

export async function recordApiHealth(
  source: ExternalApiSource,
  input: { success: boolean; payload?: any }
): Promise<{ freshness_score: number; reliability_score: number } | null> {
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

    const { error: upsertError } = await ownedDbTable('external_api_health').upsert(
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
        console.warn('external_api_health table not found. Run database/external_api_health.sql to create it.');
      } else if (!isSchemaError) {
        console.warn('Failed to persist API health record', { source: source.name });
      }
    }
    return { freshness_score: freshnessScore, reliability_score: reliabilityScore };
  } catch {
    console.warn('API health update failed', { source: source.name });
    return null;
  }
}

export async function fetchHealthMapForApiIds(
  apiIds: string[]
): Promise<Record<string, ExternalApiHealth>> {
  if (apiIds.length === 0) return {};
  const { data: healthData, error: healthError } = await ownedDbTable('external_api_health')
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

export async function getHealthForSource(
  source: ExternalApiSource,
  accountId?: string | null,
): Promise<{ freshness_score: number; reliability_score: number } | null> {
  try {
    if (accountId) {
      const { data: acctData, error: acctError } = await ownedDbTable('external_api_health')
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
    const { data, error } = await ownedDbTable('external_api_health')
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
}

// ── Usage tracking ────────────────────────────────────────────────────────────
export async function logExternalApiUsage(input: {
  apiSourceId: string;
  userId: string;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  feature?: string | null;
  companyId?: string | null;
  accountId?: string | null;
  attempt_number?: number | null;
  outcome?: 'success' | 'rate_limited' | 'failed' | 'missing_env' | 'client_error' | 'skipped' | null;
}): Promise<void> {
  try {
    const usageDate = resolveUsageDate();
    const nowIso = new Date().toISOString();
    const { data, error } = await ownedDbTable('external_api_usage')
      .select('*')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Failed to load API usage record', { apiSourceId: input.apiSourceId, userId: input.userId });
      return;
    }

    const requestCount = (data?.request_count ?? 0) + 1;
    const successCount = (data?.success_count ?? 0) + (input.success ? 1 : 0);
    const failureCount = (data?.failure_count ?? 0) + (input.success ? 0 : 1);
    const lastFailureAt = input.success ? data?.last_failure_at ?? null : nowIso;
    const lastErrorCode = input.success ? data?.last_error_code ?? null : input.errorCode ?? null;
    const lastErrorMessage = input.success ? data?.last_error_message ?? null : input.errorMessage ?? null;
    const lastErrorAt = input.success ? data?.last_error_at ?? null : nowIso;
    const lastSuccessAt = input.success ? nowIso : data?.last_success_at ?? null;

    const { error: upsertError } = await ownedDbTable('external_api_usage').upsert(
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
        ...(input.accountId !== undefined ? { account_id: input.accountId } : {}),
        ...(input.attempt_number !== undefined ? { last_attempt_number: input.attempt_number } : {}),
        ...(input.outcome !== undefined ? { last_outcome: input.outcome } : {}),
      },
      { onConflict: 'api_source_id,user_id,usage_date' }
    );

    if (upsertError) {
      const isSchemaError =
        (upsertError as { code?: string })?.code === 'PGRST205' ||
        (upsertError.message?.toLowerCase().includes('could not find the table') ?? false);
      if (isSchemaError && !(globalThis as any).__external_api_usage_schema_hint_shown) {
        (globalThis as any).__external_api_usage_schema_hint_shown = true;
        console.warn('external_api_usage table not found. Run database/external-api-usage.sql to create it.');
      } else if (!isSchemaError) {
        console.warn('Failed to update API usage record', { apiSourceId: input.apiSourceId });
      }
    }

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      await ownedDbTable('external_api_usage').upsert(
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
          ...(input.accountId !== undefined ? { account_id: input.accountId } : {}),
          ...(input.attempt_number !== undefined ? { last_attempt_number: input.attempt_number } : {}),
          ...(input.outcome !== undefined ? { last_outcome: input.outcome } : {}),
        },
        { onConflict: 'api_source_id,user_id,usage_date' }
      );
    }
  } catch {
    console.warn('API usage log failed', { apiSourceId: input.apiSourceId, userId: input.userId });
  }
}

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
    const { data, error: selectError } = await ownedDbTable('external_api_usage')
      .select('signals_generated, request_count, success_count, failure_count, last_used_at')
      .eq('api_source_id', input.apiSourceId)
      .eq('user_id', input.userId)
      .eq('usage_date', usageDate)
      .maybeSingle();

    const selectMsg = (selectError as { message?: string })?.message?.toLowerCase() ?? '';
    const isSelectSchemaError =
      selectError &&
      ((selectMsg.includes('column') && selectMsg.includes('does not exist')) ||
        selectMsg.includes('could not find the table') ||
        (selectMsg.includes('relation') && selectMsg.includes('does not exist')));
    if (isSelectSchemaError && !(globalThis as any).__external_api_usage_signals_hint_shown) {
      (globalThis as any).__external_api_usage_signals_hint_shown = true;
      console.warn('external_api_usage.signals_generated column missing. Run database/external_api_usage_signals_generated.sql.');
      return;
    }

    const current = (data?.signals_generated ?? 0) + input.count;
    await ownedDbTable('external_api_usage').upsert(
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

    if (input.feature && input.companyId) {
      const featureUserId = buildFeatureUsageUserId(input.feature, input.companyId);
      const { data: featureData } = await ownedDbTable('external_api_usage')
        .select('signals_generated, request_count, success_count, failure_count, last_used_at')
        .eq('api_source_id', input.apiSourceId)
        .eq('user_id', featureUserId)
        .eq('usage_date', usageDate)
        .maybeSingle();
      const featureCurrent = (featureData?.signals_generated ?? 0) + input.count;
      await ownedDbTable('external_api_usage').upsert(
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
    console.warn('addSignalsGenerated failed', { apiSourceId: input.apiSourceId, error: (error as Error)?.message });
  }
}

// ── Source queries ────────────────────────────────────────────────────────────
export async function getEnabledApis(companyId?: string | null): Promise<ExternalApiSource[]> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return [];
  }
  const createQuery = () =>
    ownedDbTable('external_api_sources').select('*').eq('is_active', true).order('created_at', { ascending: true });

  const scopedResult = await createQuery().or(`company_id.eq.${companyId},company_id.is.null`);
  const sources: ExternalApiSource[] = scopedResult.error ? [] : (scopedResult.data || []);
  if (scopedResult.error && !scopedResult.error.message?.toLowerCase().includes('company_id')) {
    console.warn('getEnabledApis scoped query failed', { companyId, message: scopedResult.error.message });
    const fallback = await createQuery();
    if (fallback.error) return [];
    sources.push(...(fallback.data || []));
  } else if (scopedResult.error) {
    const fallback = await createQuery();
    if (fallback.error) return [];
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
  const combined = [...companySpecific, ...selectedPresets];
  return combined.filter(isApiSourceExecutable);
}

export async function getAvailableApis(companyId?: string | null): Promise<ExternalApiSource[]> {
  if (!companyId) return [];
  console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
  const baseQuery = () =>
    ownedDbTable('external_api_sources').select('*').eq('is_active', true).order('created_at', { ascending: true });

  const scoped = await baseQuery().or(`company_id.eq.${companyId},company_id.is.null`);
  if (!scoped.error) {
    const companySpecific = (scoped.data || []).filter((row) => row.company_id === companyId);
    const globalPresets = (scoped.data || []).filter((row) => row.is_preset && !row.company_id);
    return [...companySpecific, ...globalPresets];
  }
  const fallback = await baseQuery();
  if (fallback.error) return [];
  const rows = fallback.data || [];
  const companySpecific = rows.filter((row) => row.company_id === companyId);
  const globalPresets = rows.filter((row) => row.is_preset && !row.company_id);
  return [...companySpecific, ...globalPresets];
}

export async function getUserApiAccess(userId: string): Promise<ExternalApiUserAccess[]> {
  const { data, error } = await ownedDbTable('external_api_user_access').select('*').eq('user_id', userId);
  if (error) {
    console.warn('getUserApiAccess failed', { userId, message: error.message });
    return [];
  }
  return data || [];
}

export async function getExternalApiSourceById(apiSourceId: string): Promise<ExternalApiSource | null> {
  const { data, error } = await ownedDbTable('external_api_sources')
    .select('*')
    .eq('id', apiSourceId)
    .eq('is_active', true)
    .single();
  if (error || !data) return null;
  const source = data as ExternalApiSource;
  if (!isApiSourceExecutable(source)) {
    console.warn('EXTERNAL_API_SKIPPED_BY_FILTER', { sourceId: source.id, sourceName: source.name });
    return null;
  }
  return source;
}

export async function getPlatformConfigs(
  companyId?: string | null,
  options?: { skipCache?: boolean }
): Promise<PlatformConfig[]> {
  if (!companyId) return [];
  const createQuery = () =>
    ownedDbTable('external_api_sources').select('*').order('created_at', { ascending: true });

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
    const { data: enabledSources } = await ownedDbTable('external_api_sources')
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
    const { data: fallbackSources } = await ownedDbTable('external_api_sources')
      .select('*')
      .eq('is_active', true)
      .in('id', enabledIds);
    data = fallbackSources || [];
  }

  const apiIds = data.map((row: any) => row.id);
  const healthMap = await fetchHealthMapForApiIds(apiIds);
  return data.map((row: any) => ({ ...row, health: healthMap[row.id] || null }));
}

// ── Platform config write helpers ─────────────────────────────────────────────
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
  oauth_client_id_encrypted: input.oauth_client_id_encrypted ?? null,
  oauth_client_secret_encrypted: input.oauth_client_secret_encrypted ?? null,
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
    if (lower.includes('is_preset')) delete next.is_preset;
    if (lower.includes('company_id')) delete next.company_id;
    return next;
  };

  let initial = await ownedDbTable('external_api_sources').insert(payloadWithCompany).select('*').single();
  if (!initial.error) return initial.data as ExternalApiSource;

  const message = initial.error.message || '';
  const sanitized = sanitizePayload(payloadWithCompany, message);
  if (Object.keys(sanitized).length !== Object.keys(payloadWithCompany).length) {
    initial = await ownedDbTable('external_api_sources').insert(sanitized).select('*').single();
    if (!initial.error) return initial.data as ExternalApiSource;
  }
  if (!message.toLowerCase().includes('company_id')) {
    throw new Error(`Failed to save platform config: ${message}`);
  }

  const fallback = await ownedDbTable('external_api_sources')
    .insert(sanitizePayload(basePayload, message))
    .select('*')
    .single();
  if (fallback.error) throw new Error(`Failed to save platform config: ${fallback.error.message}`);
  return fallback.data as ExternalApiSource;
}

export async function saveTenantPlatformConfig(
  input: Partial<ExternalApiSource> & { company_id: string }
): Promise<ExternalApiSource> {
  if (!input.company_id) throw new Error('company_id is required for tenant-scoped API');
  const payload = { ...buildPlatformPayload(input), company_id: input.company_id };
  let result = await ownedDbTable('external_api_sources').insert(payload).select('*').single();

  if (result.error) {
    const message = result.error.message || '';
    if (message.toLowerCase().includes('is_preset')) {
      const sanitized = { ...payload };
      delete (sanitized as any).is_preset;
      result = await ownedDbTable('external_api_sources').insert(sanitized).select('*').single();
      if (!result.error) return result.data as ExternalApiSource;
    }
    if (message.toLowerCase().includes('company_id')) {
      throw new Error('company_id column missing for tenant-scoped API');
    }
    throw new Error(`Failed to save tenant platform config: ${message}`);
  }
  return result.data as ExternalApiSource;
}

export async function checkCompanyApiLimitsForPolling(
  companyId: string,
  apiSourceId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: configRow, error: configErr } = await ownedDbTable('company_api_configs')
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
  const { data: usageRow } = await ownedDbTable('external_api_usage')
    .select('request_count, signals_generated')
    .eq('api_source_id', apiSourceId)
    .eq('user_id', featureUserId)
    .eq('usage_date', today)
    .maybeSingle();

  const requests = (usageRow as { request_count?: number } | null)?.request_count ?? 0;
  const signals = (usageRow as { signals_generated?: number } | null)?.signals_generated ?? 0;
  if (dailyLimit != null && requests >= dailyLimit) return { allowed: false, reason: `daily_limit (${requests}/${dailyLimit})` };
  if (signalLimit != null && signals >= signalLimit) return { allowed: false, reason: `signal_limit (${signals}/${signalLimit})` };
  return { allowed: true };
}
