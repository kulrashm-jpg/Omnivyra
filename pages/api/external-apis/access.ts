import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getAvailableApis,
  getCompanyDefaultApiIds,
  getEnabledApis,
  getUserApiAccess,
} from '../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';

const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

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
      const { role, error: roleError } = await getUserRole(user.id, companyId);
      if (roleError || !role) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
      canManageExternalApis = await hasPermission(role, 'MANAGE_EXTERNAL_APIS');
    }
  }

  if (req.method === 'GET') {
    try {
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
            const existing = acc[key] || { feature: key, request_count: 0, success_count: 0, failure_count: 0 };
            existing.request_count += row.request_count ?? 0;
            existing.success_count += row.success_count ?? 0;
            existing.failure_count += row.failure_count ?? 0;
            acc[key] = existing;
            return acc;
          }, {});
        const byUser = nonFeatureRows.reduce<Record<string, any>>((acc, row) => {
          const parsed = parseUsageUserId(row.user_id);
          const key = parsed.userId || row.user_id;
          const existing = acc[key] || { user_id: key, request_count: 0, success_count: 0, failure_count: 0 };
          existing.request_count += row.request_count ?? 0;
          existing.success_count += row.success_count ?? 0;
          existing.failure_count += row.failure_count ?? 0;
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
            })),
        };
      });

      const fetchGlobalPresets = async () => {
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
          throw new Error('Failed to load global presets');
        }
        const fallbackResult = await baseQuery();
        if (fallbackResult.error) {
          throw new Error('Failed to load global presets');
        }
        return (fallbackResult.data || []).filter((row) => !row.company_id);
      };
      const globalPresets = await fetchGlobalPresets();
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
      return res.status(500).json({ error: 'Failed to load external API access' });
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!canManageExternalApis) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const {
      company_default_api_ids,
      api_source_id,
      is_enabled,
      api_key_env_name,
      headers_override,
      query_params_override,
      rate_limit_per_min,
      scope,
    } = req.body || {};

    if (scope && scope !== 'company') {
      return res.status(400).json({ error: 'scope must be company' });
    }
    const scopedUserId = buildCompanyAccessUserId(companyId);
    const nowIso = new Date().toISOString();
    const availableApis = await getAvailableApis(companyId);
    const availableIds = new Set(availableApis.map((api) => api.id));

    if (Array.isArray(company_default_api_ids)) {
      const desiredIds = company_default_api_ids.filter((id) => availableIds.has(id));
      const { data: existingRows } = await supabase
        .from('external_api_user_access')
        .select('api_source_id, is_enabled')
        .eq('user_id', scopedUserId);
      const existingMap = (existingRows || []).reduce<Record<string, boolean>>((acc, row) => {
        acc[row.api_source_id] = row.is_enabled === true;
        return acc;
      }, {});

      const payloads = Array.from(availableIds).map((apiId) => ({
        api_source_id: apiId,
        user_id: scopedUserId,
        is_enabled: desiredIds.includes(apiId),
        api_key_env_name: null,
        headers_override: {},
        query_params_override: {},
        rate_limit_per_min: null,
        updated_at: nowIso,
      }));

      const { error: upsertError } = await supabase
        .from('external_api_user_access')
        .upsert(payloads, { onConflict: 'api_source_id,user_id' });
      if (upsertError) {
        return res.status(500).json({ error: 'Failed to update API access' });
      }

      const newlyEnabledGlobalPresets = availableApis.filter(
        (api) =>
          api.is_preset === true &&
          !api.company_id &&
          desiredIds.includes(api.id) &&
          !existingMap[api.id]
      );
      if (newlyEnabledGlobalPresets.length > 0) {
        await supabase.from('audit_logs').insert(
          newlyEnabledGlobalPresets.map((api) => ({
            actor_user_id: user.id,
            action: 'EXTERNAL_API_GLOBAL_PRESET_ENABLED',
            company_id: companyId,
            metadata: {
              api_source_id: api.id,
              api_name: api.name,
            },
            created_at: nowIso,
          }))
        );
      }

      return res.status(200).json({ access: { user_id: scopedUserId, api_source_ids: desiredIds } });
    }

    if (!api_source_id) {
      return res.status(400).json({ error: 'api_source_id is required' });
    }

    const payload = {
      api_source_id,
      user_id: scopedUserId,
      is_enabled: typeof is_enabled === 'boolean' ? is_enabled : false,
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
      return res.status(500).json({ error: 'Failed to update API access' });
    }

    if (payload.is_enabled) {
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

    return res.status(200).json({ access: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
