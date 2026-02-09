import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getPlatformConfigs,
  getExternalApiRuntimeSnapshot,
  savePlatformConfig,
  validatePlatformConfig,
} from '../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../backend/services/rbacService';

const requireExternalApiAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string,
  requireManage = false
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) {
    return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (requireManage && !hasPermission(role, 'MANAGE_EXTERNAL_APIS')) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

const requirePlatformAdmin = async (req: NextApiRequest, res: NextApiResponse) => {
  const legacySession = getLegacySuperAdminSession(req);
  if (legacySession) {
    return { userId: legacySession.userId, role: 'SUPER_ADMIN' };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  return null;
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query?.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const platformScopeRequested = req.query?.scope === 'platform';
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }

  if (req.method === 'GET') {
    const access = platformScopeRequested && !companyId
      ? await requirePlatformAdmin(req, res)
      : await requireExternalApiAccess(req, res, companyId, false);
    if (!access) return;
    const canManageExternalApis =
      access.role === 'SUPER_ADMIN' || hasPermission(access.role, 'MANAGE_EXTERNAL_APIS');
    try {
      const apis = platformScopeRequested && !companyId
        ? (await supabase
            .from('external_api_sources')
            .select('*')
            .is('company_id', null)
            .order('created_at', { ascending: true })).data || []
        : await getPlatformConfigs(companyId);
      const since = new Date();
      since.setDate(since.getDate() - 13);
      const sinceDate = since.toISOString().slice(0, 10);
      const apiIds = apis.map((api) => api.id);
      let healthMap: Record<string, any> = {};
      if (apiIds.length > 0) {
        const { data: healthData, error: healthError } = await supabase
          .from('external_api_health')
          .select('*')
          .in('api_source_id', apiIds);
        if (!healthError && healthData) {
          healthMap = healthData.reduce((acc: Record<string, any>, row: any) => {
            acc[row.api_source_id] = {
              api_source_id: row.api_source_id,
              freshness_score: row.freshness_score ?? 1,
              reliability_score: row.reliability_score ?? 1,
            };
            return acc;
          }, {});
        }
      }

      const { data: accessRows } = apiIds.length
        ? await supabase
            .from('external_api_user_access')
            .select('*')
            .eq('is_enabled', true)
            .in('api_source_id', apiIds)
        : { data: [] };

      const { data: usageRows } = apiIds.length
        ? await supabase
            .from('external_api_usage')
            .select('*')
            .gte('usage_date', sinceDate)
            .in('api_source_id', apiIds)
        : { data: [] };

      const enabledCountMap = (accessRows || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.api_source_id] = (acc[row.api_source_id] || 0) + 1;
        return acc;
      }, {});

      const enabledCompaniesByApi = (accessRows || []).reduce<Record<string, string[]>>(
        (acc, row) => {
          if (!row.user_id || !String(row.user_id).startsWith('company:')) {
            return acc;
          }
          const companyId = String(row.user_id).slice('company:'.length);
          acc[row.api_source_id] = acc[row.api_source_id] || [];
          if (!acc[row.api_source_id].includes(companyId)) {
            acc[row.api_source_id].push(companyId);
          }
          return acc;
        },
        {}
      );

      const usageByApi = (usageRows || []).reduce<Record<string, any[]>>((acc, row) => {
        acc[row.api_source_id] = acc[row.api_source_id] || [];
        acc[row.api_source_id].push(row);
        return acc;
      }, {});

      const enriched = apis.map((api) => {
        const rows = usageByApi[api.id] || [];
        const nonFeatureRows = rows.filter((row) => !String(row.user_id || '').startsWith('feature:'));
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
        const usageByCompany = rows.reduce<Record<string, any>>((acc, row) => {
          const parsed = parseUsageUserId(String(row.user_id || ''));
          if (!parsed.companyId) return acc;
          const existing = acc[parsed.companyId] || {
            company_id: parsed.companyId,
            request_count: 0,
            success_count: 0,
            failure_count: 0,
            by_feature: {},
            by_user: {},
          };
          existing.request_count += row.request_count ?? 0;
          existing.success_count += row.success_count ?? 0;
          existing.failure_count += row.failure_count ?? 0;
          if (parsed.kind === 'feature') {
            const featureKey = parsed.feature || 'unknown';
            const feature = existing.by_feature[featureKey] || {
              feature: featureKey,
              request_count: 0,
              success_count: 0,
              failure_count: 0,
            };
            feature.request_count += row.request_count ?? 0;
            feature.success_count += row.success_count ?? 0;
            feature.failure_count += row.failure_count ?? 0;
            existing.by_feature[featureKey] = feature;
          } else if (parsed.kind === 'user') {
            const userKey = parsed.userId || 'unknown';
            const user = existing.by_user[userKey] || {
              user_id: userKey,
              request_count: 0,
              success_count: 0,
              failure_count: 0,
            };
            user.request_count += row.request_count ?? 0;
            user.success_count += row.success_count ?? 0;
            user.failure_count += row.failure_count ?? 0;
            existing.by_user[userKey] = user;
          }
          acc[parsed.companyId] = existing;
          return acc;
        }, {});
        return {
          ...api,
          health: (api as any).health || healthMap[api.id] || null,
          enabled_user_count: enabledCountMap[api.id] || 0,
          enabled_companies: enabledCompaniesByApi[api.id] || [],
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
            failure_rate: requestCount > 0 ? Number((failureCount / requestCount).toFixed(3)) : 0,
          },
          usage_by_company: Object.values(usageByCompany).map((entry: any) => ({
            company_id: entry.company_id,
            request_count: entry.request_count,
            success_count: entry.success_count,
            failure_count: entry.failure_count,
            by_feature: Object.values(entry.by_feature || {}),
            by_user: Object.values(entry.by_user || {}),
          })),
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

      const runtime = await getExternalApiRuntimeSnapshot(apiIds);
      return res.status(200).json({
        apis: enriched,
        runtime,
        permissions: { canManageExternalApis },
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load external APIs' });
    }
  }

  if (req.method === 'POST') {
    const access = platformScopeRequested && !companyId
      ? await requirePlatformAdmin(req, res)
      : await requireExternalApiAccess(req, res, companyId, true);
    if (!access) return;
    const {
      name,
      base_url,
      purpose,
      category,
      is_active,
      method,
      auth_type,
      api_key_name,
      api_key_env_name,
      headers,
      query_params,
      is_preset,
      retry_count,
      timeout_ms,
      rate_limit_per_min,
      platform_type,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
      requires_admin,
    } = req.body || {};

    const resolvedPlatformType = platform_type || 'social';
    const validation = validatePlatformConfig({
      name,
      base_url,
      platform_type: resolvedPlatformType,
      method,
      headers,
      query_params,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message || 'Invalid platform config' });
    }
    const resolvedApiKeyEnv = api_key_env_name || api_key_name || null;
    if (platformScopeRequested && !companyId) {
      const api = await savePlatformConfig({
        name,
        base_url,
        purpose,
        category: category || null,
        is_active: is_active ?? true,
        method: method || 'GET',
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        api_key_env_name: resolvedApiKeyEnv,
        headers: headers || {},
        query_params: query_params || {},
        is_preset: is_preset ?? false,
        retry_count: retry_count ?? 2,
        timeout_ms: timeout_ms ?? 8000,
        rate_limit_per_min: rate_limit_per_min ?? 60,
        platform_type: resolvedPlatformType,
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
        company_id: null,
        created_at: new Date().toISOString(),
      });
      return res.status(201).json({ api });
    }

    const { data, error } = await supabase
      .from('external_api_sources')
      .insert({
        name,
        base_url,
        purpose,
        category: category || null,
        is_active: is_active ?? true,
        method: method || 'GET',
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        api_key_env_name: resolvedApiKeyEnv,
        headers: headers || {},
        query_params: query_params || {},
        is_preset: is_preset ?? false,
        retry_count: retry_count ?? 2,
        timeout_ms: timeout_ms ?? 8000,
        rate_limit_per_min: rate_limit_per_min ?? 60,
        platform_type: resolvedPlatformType,
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
        company_id: companyId,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create external API' });
    }
    return res.status(201).json({ api: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
