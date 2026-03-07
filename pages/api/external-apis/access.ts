import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getAvailableApis,
  getCompanyDefaultApiIds,
  getEnabledApis,
  getEnabledApiIdsFromCompanyConfig,
  getUserApiAccess,
} from '../../../backend/services/externalApiService';
import {
  invalidateCompanyConfigCache,
  getCompanyConfigRows,
} from '../../../backend/services/companyApiConfigCache';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';

const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const MAX_ENABLED_APIS_PER_COMPANY = 20;
const buildUsageUserId = (userId: string, companyId: string) => `${userId}:${companyId}`;
const buildCompanyAccessUserId = (companyId: string) => `company:${companyId}`;
const buildFeatureUsageUserIdPrefix = (companyId: string) => `feature:%|company:${companyId}`;
const isFeatureUsageRow = (userId: string) => userId.startsWith('feature:');
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const legacySession = getLegacySuperAdminSession(req);
  const { user, error } = legacySession ? { user: { id: legacySession.userId }, error: null } : await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  let canManageExternalApis = false;
  if (legacySession) {
    canManageExternalApis = true;
  } else {
    const platformAdmin = await isPlatformSuperAdmin(user.id);
    if (platformAdmin) {
      canManageExternalApis = true;
    } else if (await isSuperAdmin(user.id)) {
      console.debug('SUPER_ADMIN_FALLBACK', {
        path: req.url,
        userId: user.id,
        source: 'rbacService.isSuperAdmin',
      });
      canManageExternalApis = true;
    } else {
      let { role, error: roleError } = await getUserRole(user.id, companyId);
      if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
        const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
        if (fallbackRole) {
          role = fallbackRole;
          roleError = null;
        }
      }
      if (roleError || !role) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
      canManageExternalApis = await hasPermission(role, 'MANAGE_EXTERNAL_APIS');
    }
  }

  if (req.method === 'GET') {
    try {
      await getCompanyConfigRows(companyId);
      const sources = await getEnabledApis(companyId);
      const availableApis = await getAvailableApis(companyId);
      const companyDefaultApiIds = await getCompanyDefaultApiIds(companyId);
      const accessRows = await getUserApiAccess(user.id);
      const accessMap = accessRows.reduce<Record<string, any>>((acc, row) => {
        acc[row.api_source_id] = row;
        return acc;
      }, {});

      const since = new Date();
      since.setDate(since.getDate() - 13);
      const sinceDate = since.toISOString().slice(0, 10);
      const apiIds = availableApis.map((api) => api.id);
      const userUsageId = buildUsageUserId(user.id, companyId);
      const { data: usageRows } = apiIds.length
        ? await supabase
            .from('external_api_usage')
            .select('*')
            .gte('usage_date', sinceDate)
            .in('api_source_id', apiIds)
            .or(
              `user_id.like.%:${companyId},user_id.like.${buildFeatureUsageUserIdPrefix(companyId)}`
            )
        : { data: [] };

      const usageByApi = (usageRows || []).reduce<Record<string, any[]>>((acc, row) => {
        acc[row.api_source_id] = acc[row.api_source_id] || [];
        acc[row.api_source_id].push(row);
        return acc;
      }, {});

      const apis = sources.map((source) => {
        const rows = usageByApi[source.id] || [];
        const nonFeatureRows = rows.filter((row) => !isFeatureUsageRow(row.user_id));
        const requestCount = nonFeatureRows.reduce(
          (sum, row) => sum + (row.request_count ?? 0),
          0
        );
        const successCount = nonFeatureRows.reduce(
          (sum, row) => sum + (row.success_count ?? 0),
          0
        );
        const failureCount = nonFeatureRows.reduce(
          (sum, row) => sum + (row.failure_count ?? 0),
          0
        );
        const signalsGenerated = rows.reduce(
          (sum, row) => sum + (row.signals_generated ?? 0),
          0
        );
        const lastUsedAt = rows.reduce<string | null>((latest, row) => {
          if (!row.last_used_at) return latest;
          if (!latest) return row.last_used_at;
          return new Date(row.last_used_at) > new Date(latest) ? row.last_used_at : latest;
        }, null);
        const lastFailureAt = rows.reduce<string | null>((latest, row) => {
          if (!row.last_failure_at) return latest;
          if (!latest) return row.last_failure_at;
          return new Date(row.last_failure_at) > new Date(latest) ? row.last_failure_at : latest;
        }, null);
        const lastError = rows.reduce<{ at?: string | null; message?: string | null; code?: string | null }>(
          (acc, row) => {
            if (!row.last_error_message) return acc;
            if (!row.last_error_at) return acc;
            if (!acc.at || new Date(row.last_error_at) > new Date(acc.at)) {
              return { at: row.last_error_at, message: row.last_error_message, code: row.last_error_code };
            }
            return acc;
          },
          {}
        );
        const lastSuccessAt = rows.reduce<string | null>((latest, row) => {
          if (!row.last_success_at) return latest;
          if (!latest) return row.last_success_at;
          return new Date(row.last_success_at) > new Date(latest) ? row.last_success_at : latest;
        }, null);

        const byFeature = rows
          .filter((row) => isFeatureUsageRow(row.user_id))
          .reduce<Record<string, any>>((acc, row) => {
            const parsed = parseUsageUserId(row.user_id);
            const key = parsed.feature || 'unknown';
            const existing = acc[key] || { feature: key, request_count: 0, success_count: 0, failure_count: 0, signals_generated: 0 };
            existing.request_count += row.request_count ?? 0;
            existing.success_count += row.success_count ?? 0;
            existing.failure_count += row.failure_count ?? 0;
            existing.signals_generated = (existing.signals_generated ?? 0) + (row.signals_generated ?? 0);
            acc[key] = existing;
            return acc;
          }, {});
        const byUser = nonFeatureRows.reduce<Record<string, any>>((acc, row) => {
          const parsed = parseUsageUserId(row.user_id);
          const key = parsed.userId || row.user_id;
          const existing = acc[key] || { user_id: key, request_count: 0, success_count: 0, failure_count: 0, signals_generated: 0 };
          existing.request_count += row.request_count ?? 0;
          existing.success_count += row.success_count ?? 0;
          existing.failure_count += row.failure_count ?? 0;
          existing.signals_generated = (existing.signals_generated ?? 0) + (row.signals_generated ?? 0);
          acc[key] = existing;
          return acc;
        }, {});
        return {
          ...source,
          user_access: accessMap[source.id] || null,
          usage_summary: {
            request_count: requestCount,
            success_count: successCount,
            failure_count: failureCount,
            signals_generated: signalsGenerated,
            last_used_at: lastUsedAt,
            last_failure_at: lastFailureAt,
            last_error_message: lastError.message || null,
            last_error_code: lastError.code || null,
            last_error_at: lastError.at || null,
            last_success_at: lastSuccessAt,
          },
          usage_company: {
            total_calls: requestCount,
            success_count: successCount,
            failure_count: failureCount,
            signals_generated: signalsGenerated,
          },
          usage_by_feature: Object.values(byFeature),
          usage_by_user: Object.values(byUser),
          usage_daily: rows
            .sort((a, b) => String(a.usage_date).localeCompare(String(b.usage_date)))
            .map((row) => ({
              usage_date: row.usage_date,
              request_count: row.request_count ?? 0,
              success_count: row.success_count ?? 0,
              failure_count: row.failure_count ?? 0,
              signals_generated: row.signals_generated ?? 0,
            })),
        };
      });

      const fetchGlobalPresets = async (): Promise<typeof availableApis> => {
        const baseQuery = () =>
          supabase
            .from('external_api_sources')
            .select('*')
            .eq('is_preset', true)
            .eq('is_active', true)
            .order('created_at', { ascending: true });
        const scopedResult = await baseQuery().is('company_id', null);
        if (!scopedResult.error) {
          return scopedResult.data || [];
        }
        const message = scopedResult.error.message || '';
        if (!message.toLowerCase().includes('company_id')) {
          console.warn('fetchGlobalPresets scoped failed', { message });
        }
        const fallbackResult = await baseQuery();
        if (fallbackResult.error) {
          console.warn('fetchGlobalPresets fallback failed', { message: fallbackResult.error.message });
          return [];
        }
        return (fallbackResult.data || []).filter((row: { company_id?: string | null }) => !row.company_id);
      };
      let globalPresets: Awaited<ReturnType<typeof fetchGlobalPresets>>;
      try {
        globalPresets = await fetchGlobalPresets();
      } catch (presetErr) {
        console.warn('fetchGlobalPresets error', presetErr);
        globalPresets = [];
      }
      const available = availableApis.map((api) => {
        const isGlobalPreset = api.is_preset === true && !api.company_id;
        return {
          ...api,
          is_global_preset: isGlobalPreset,
          isGlobalPreset,
        };
      });

      return res
        .status(200)
        .json({
          apis,
          availableApis: available,
          companyDefaultApis: companyDefaultApiIds,
          global_presets: globalPresets,
          permissions: { canManageExternalApis },
        });
    } catch (error) {
      console.error('access GET failed', error);
      return res.status(500).json({
        error: 'Failed to load external API access',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!canManageExternalApis) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const {
      company_default_api_ids,
      api_source_id,
      is_enabled,
      api_key_env_name,
      headers_override,
      query_params_override,
      rate_limit_per_min,
      scope,
    } = body;

    if (scope && scope !== 'company') {
      return res.status(400).json({ error: 'scope must be company' });
    }
    const scopedUserId = buildCompanyAccessUserId(companyId);
    const nowIso = new Date().toISOString();
    let availableApis: Awaited<ReturnType<typeof getAvailableApis>>;
    try {
      availableApis = await getAvailableApis(companyId);
    } catch ( err) {
      console.error('access POST getAvailableApis failed', err);
      return res.status(500).json({
        error: 'Failed to load available APIs',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // Ensure company exists in companies table (company_api_configs FK requires it)
    const { data: existingCompany, error: companyErr } = await supabase
      .from('companies')
      .select('id')
      .eq('id', companyId)
      .maybeSingle();
    if (companyErr || !existingCompany) {
      const { data: profile } = await supabase
        .from('company_profiles')
        .select('company_id, name')
        .eq('company_id', companyId)
        .maybeSingle();
      const { error: insertErr } = await supabase.from('companies').upsert(
        {
          id: companyId,
          name: profile?.name || 'Company',
          website: `https://company-${companyId}.local`,
          status: 'active',
        },
        { onConflict: 'id' }
      );
      if (insertErr) {
        console.error('access POST ensure company failed', insertErr);
        return res.status(500).json({
          error: 'Company not found or could not be created',
          detail: insertErr.message,
        });
      }
    }

    const availableIds = new Set(availableApis.map((api) => api.id));

    if (Array.isArray(company_default_api_ids)) {
      const desiredIds = company_default_api_ids.filter((id) => availableIds.has(id));
      if (desiredIds.length > MAX_ENABLED_APIS_PER_COMPANY) {
        return res.status(400).json({
          error: 'Maximum API sources reached for your plan.',
          max: MAX_ENABLED_APIS_PER_COMPANY,
        });
      }
      const existingEnabled = await getEnabledApiIdsFromCompanyConfig(companyId);
      const existingSet = new Set(existingEnabled);

      for (const apiId of availableIds) {
        const enabled = desiredIds.includes(apiId);
        const { error: configError } = await supabase.from('company_api_configs').upsert(
          {
            company_id: companyId,
            api_source_id: apiId,
            enabled,
            polling_frequency: 'daily',
            priority: 'MEDIUM',
            purposes: [],
            include_filters: {},
            exclude_filters: {},
            updated_at: nowIso,
          },
          { onConflict: 'company_id,api_source_id' }
        );
        if (configError) {
          console.error('access POST bulk company_api_configs upsert failed', configError);
          return res.status(500).json({
            error: 'Failed to update company API config',
            detail: configError.message,
          });
        }
      }

      const newlyEnabled = availableApis.filter(
        (api) =>
          api.is_preset === true &&
          !api.company_id &&
          desiredIds.includes(api.id) &&
          !existingSet.has(api.id)
      );
      if (newlyEnabled.length > 0) {
        await supabase.from('audit_logs').insert(
          newlyEnabled.map((api) => ({
            actor_user_id: user.id,
            action: 'EXTERNAL_API_GLOBAL_PRESET_ENABLED',
            company_id: companyId,
            metadata: { api_source_id: api.id, api_name: api.name },
            created_at: nowIso,
          }))
        );
      }

      invalidateCompanyConfigCache(companyId);
      return res.status(200).json({ access: { user_id: scopedUserId, api_source_ids: desiredIds } });
    }

    if (!api_source_id) {
      return res.status(400).json({ error: 'api_source_id is required' });
    }

    if (typeof is_enabled === 'boolean') {
      if (is_enabled) {
        const existingEnabled = await getEnabledApiIdsFromCompanyConfig(companyId);
        const alreadyEnabled = existingEnabled.includes(api_source_id);
        if (!alreadyEnabled && existingEnabled.length >= MAX_ENABLED_APIS_PER_COMPANY) {
          return res.status(400).json({
            error: 'Maximum API sources reached for your plan.',
            max: MAX_ENABLED_APIS_PER_COMPANY,
          });
        }
      }
      const { error: configError } = await supabase.from('company_api_configs').upsert(
        {
          company_id: companyId,
          api_source_id,
          enabled: is_enabled,
          polling_frequency: 'daily',
          priority: 'MEDIUM',
          purposes: [],
          include_filters: {},
          exclude_filters: {},
          updated_at: nowIso,
        },
        { onConflict: 'company_id,api_source_id' }
      );
      if (configError) {
        console.error('access POST company_api_configs upsert failed', configError);
        return res.status(500).json({
          error: 'Failed to update company API config',
          detail: configError.message,
        });
      }
      invalidateCompanyConfigCache(companyId);
      if (is_enabled) {
        const source = availableApis.find((api) => api.id === api_source_id);
        if (source?.is_preset && !source.company_id) {
          await supabase.from('audit_logs').insert({
            actor_user_id: user.id,
            action: 'EXTERNAL_API_GLOBAL_PRESET_ENABLED',
            company_id: companyId,
            metadata: { api_source_id: source.id, api_name: source.name },
            created_at: nowIso,
          });
        }
      }
    }

    const hasOverrides =
      (api_key_env_name != null && String(api_key_env_name).trim() !== '') ||
      (headers_override != null && Object.keys(normalizeRecord(headers_override)).length > 0) ||
      (query_params_override != null && Object.keys(normalizeRecord(query_params_override)).length > 0) ||
      (typeof rate_limit_per_min === 'number');

    if (hasOverrides) {
      const payload = {
        api_source_id,
        user_id: scopedUserId,
        api_key_env_name: api_key_env_name ? String(api_key_env_name).trim() : null,
        headers_override: normalizeRecord(headers_override),
        query_params_override: normalizeRecord(query_params_override),
        rate_limit_per_min: typeof rate_limit_per_min === 'number' ? rate_limit_per_min : null,
        updated_at: nowIso,
      };

      const { data, error } = await supabase
        .from('external_api_user_access')
        .upsert(payload, { onConflict: 'api_source_id,user_id' })
        .select('*')
        .single();

      if (error) {
        console.error('access POST external_api_user_access upsert failed', error);
        return res.status(500).json({
          error: 'Failed to update API access',
          detail: error.message,
        });
      }
      return res.status(200).json({ access: data });
    }

    return res.status(200).json({
      access: {
        api_source_id,
        user_id: scopedUserId,
        updated: 'company_api_config_only',
      },
    });
    } catch (err) {
      console.error('access POST failed', err);
      return res.status(500).json({
        error: 'Failed to update API access',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
