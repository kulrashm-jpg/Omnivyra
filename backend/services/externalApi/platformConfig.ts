import { supabase } from '../../db/supabaseClient';
import type {
  ExternalApiSource,
  ExternalApiHealth,
  PlatformConfig,
  PlatformStrategy,
} from './types';
import { isApiSourceExecutable, getEnabledApiIdsFromCompanyConfig } from './accessChecks';
import { validatePlatformConfig } from './requestValidation';
import {

  DEFAULT_RETRY_COUNT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_PER_MIN,
} from './requestValidation';
import { ownedDbTable } from '../../db/writeOwner';

// ── Re-export validatePlatformConfig so callers can import from here ──────────
export { validatePlatformConfig } from './requestValidation';

// ── Health map helper ─────────────────────────────────────────────────────────
async function fetchHealthMapForApiIds(
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

// ── Platform payload builder ──────────────────────────────────────────────────
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

// ── CRUD ──────────────────────────────────────────────────────────────────────
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

  let initial = await ownedDbTable('external_api_sources')
    .insert(payloadWithCompany)
    .select('*')
    .single();

  if (!initial.error) {
    return initial.data as ExternalApiSource;
  }
  const message = initial.error.message || '';
  const sanitized = sanitizePayload(payloadWithCompany, message);
  if (Object.keys(sanitized).length !== Object.keys(payloadWithCompany).length) {
    initial = await ownedDbTable('external_api_sources')
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

  const fallback = await ownedDbTable('external_api_sources')
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
  let result = await ownedDbTable('external_api_sources')
    .insert(payload)
    .select('*')
    .single();

  if (result.error) {
    const message = result.error.message || '';
    if (message.toLowerCase().includes('is_preset')) {
      const sanitized = { ...payload };
      delete (sanitized as any).is_preset;
      result = await ownedDbTable('external_api_sources')
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

/**
 * The external_api_sources rows a company may see: PLATFORM rows (company_id IS NULL) plus its OWN rows. Two
 * structural reads merged in memory (PostgREST cannot express "IS NULL OR = x" without an interpolated .or()),
 * ordered by created_at like the single read they replace. An error on either read is returned as-is.
 */
async function visibleSources(base: () => any, companyId: string): Promise<{ data: any[] | null; error: any }> {
  const [platform, own] = await Promise.all([base().is('company_id', null), base().eq('company_id', companyId)]);
  if (platform.error || own.error) return { data: null, error: platform.error ?? own.error };
  const rows = [...(platform.data || []), ...(own.data || [])];
  rows.sort((a: any, b: any) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return { data: rows, error: null };
}

/**
 * May `companyId` reference external_api_sources row `sourceId` (e.g. enable it in company_api_configs)? Only a
 * PLATFORM row or the company's OWN row. 'error' = the check could not be made (answer 5xx, never "not found").
 */
export async function sourceVisibleToCompany(sourceId: string, companyId: string): Promise<'visible' | 'not_found' | 'error'> {
  if (!sourceId || !companyId) return 'not_found';
  const { data, error } = await visibleSources(() => ownedDbTable('external_api_sources').select('id').eq('id', sourceId), companyId);
  if (error) return 'error';
  return (data || []).length > 0 ? 'visible' : 'not_found';
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
    ownedDbTable('external_api_sources')
      .select('*')
      .order('created_at', { ascending: true });

  // Tenant isolation AT THE READ (05/e9 2026-11-14): PLATFORM rows (company_id IS NULL) + this company's OWN rows, as
  // two structural reads merged in memory - never an interpolated .or() filter string.
  const scopedResult = await visibleSources(createQuery, companyId);
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
    // The ids come from this company's company_api_configs, which is NOT trusted for isolation (a config row could name
    // another tenant's source): only platform rows or this company's own rows are ever returned.
    const { data: enabledSources } = await visibleSources(
      () => ownedDbTable('external_api_sources').select('*').eq('is_active', true).in('id', enabledIds),
      companyId,
    );
    const fetched = (enabledSources || []).filter(
      (row: any) => !companySpecific.some((c: any) => c.id === row.id)
    );
    selectedPresets = fetched;
  }

  let data = [...companySpecific, ...selectedPresets];
  if (companyId && data.length === 0 && enabledIds.length > 0) {
    const { data: fallbackSources } = await visibleSources(
      () => ownedDbTable('external_api_sources').select('*').eq('is_active', true).in('id', enabledIds),
      companyId,
    );
    data = fallbackSources || [];
  }

  const apiIds = data.map((row: any) => row.id);
  const healthMap = await fetchHealthMapForApiIds(apiIds);

  return data.map((row: any) => ({
    ...row,
    health: healthMap[row.id] || null,
  }));
}

/**
 * Get social + community APIs for company admins. Excludes trend APIs.
 * platform_type IN ('social', 'community') AND is_active = TRUE.
 * Used by Social Platform Settings page.
 */
export async function getSocialPostingConfigs(
  companyId: string | null | undefined,
  options?: { skipCache?: boolean; platformScope?: boolean }
): Promise<PlatformConfig[]> {
  if (options?.platformScope) {
    const { data, error } = await ownedDbTable('external_api_sources')
      .select('*')
      .in('platform_type', ['social', 'community'])
      .neq('purpose', 'trends')
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    const apiIds = data.map((row: any) => row.id);
    const healthMap = await fetchHealthMapForApiIds(apiIds);
    return data.map((row: any) => ({
      ...row,
      health: healthMap[row.id] || null,
    }));
  }
  if (!companyId) return [];
  const all = await getPlatformConfigs(companyId, options);
  return all.filter(
    (c) => {
      const pt = (c.platform_type || 'social').toLowerCase();
      const isSocialOrCommunity = pt === 'social' || pt === 'community' || pt === 'video' || pt === 'blog' || pt === 'podcast';
      return isSocialOrCommunity && c.is_active !== false && (c.purpose || '').toLowerCase() !== 'trends';
    }
  );
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
    ownedDbTable('external_api_sources')
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
  if (!isApiSourceExecutable(record as ExternalApiSource)) {
    console.warn('EXTERNAL_API_SKIPPED_BY_FILTER', {
      sourceId: (record as any).id,
      sourceName: (record as any).name,
      is_enabled_global: (record as any).is_enabled_global,
      category: (record as any).category,
      is_whitelisted: (record as any).is_whitelisted,
    });
    return null;
  }

  const health = await getApiHealthByPlatform(companyId, platform);
  return {
    ...record,
    health,
  };
}

export async function getApiConfigByPlatform(
  companyId: string | null | undefined,
  platform: string
): Promise<ExternalApiSource | null> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return null;
  }
  const { data, error } = await ownedDbTable('external_api_sources')
    .select('*')
    .eq('company_id', companyId)
    .or(`category.eq.${platform},name.ilike.%${platform}%`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('Failed to load external API config', { platform });
    return null;
  }

  const record = (data?.[0] ?? null) as ExternalApiSource | null;
  if (record && !isApiSourceExecutable(record)) {
    console.warn('EXTERNAL_API_SKIPPED_BY_FILTER', {
      sourceId: record.id,
      sourceName: record.name,
      is_enabled_global: record.is_enabled_global,
      category: record.category,
      is_whitelisted: record.is_whitelisted,
    });
    return null;
  }
  return record;
}

export async function getApiHealthByPlatform(
  companyId: string | null | undefined,
  platform: string
): Promise<ExternalApiHealth | null> {
  const config = await getApiConfigByPlatform(companyId, platform);
  if (!config) return null;
  const { data, error } = await ownedDbTable('external_api_health')
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
