import { supabase } from '../../db/supabaseClient';
import type {
  ExternalApiSource,
  ExternalApiUserAccess,
  ExternalApiAccessConfig,
} from './types';
import { isApiSourceExecutable, getEnabledApiIdsFromCompanyConfig } from './accessChecks';
import { normalizeRecord, applyOverrides, resolveAccessApiKeyEnvName } from './requestValidation';

// ── Re-export for convenience ─────────────────────────────────────────────────
export { getEnabledApiIdsFromCompanyConfig } from './accessChecks';

export async function getCompanyDefaultApiIds(companyId: string): Promise<string[]> {
  return getEnabledApiIdsFromCompanyConfig(companyId);
}

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
  const combined = [...companySpecific, ...selectedPresets];
  return combined.filter(isApiSourceExecutable);
}

export async function getAvailableApis(companyId?: string | null): Promise<ExternalApiSource[]> {
  if (!companyId) {
    console.log('EXTERNAL_API_COMPANY_SCOPE', companyId);
    return [];
  }
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
  const source = data as ExternalApiSource;
  if (!isApiSourceExecutable(source)) {
    console.warn('EXTERNAL_API_SKIPPED_BY_FILTER', {
      sourceId: source.id,
      sourceName: source.name,
      is_enabled_global: source.is_enabled_global,
      category: source.category,
      is_whitelisted: source.is_whitelisted,
    });
    return null;
  }
  return source;
}
