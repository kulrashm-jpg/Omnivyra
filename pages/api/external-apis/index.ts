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
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';
import { encryptCredential } from '../../../backend/auth/credentialEncryption';
import { checkAndGrantSetupCredits } from '../../../backend/services/earnCreditsService';

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
  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (requireManage && !(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
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
      access.role === 'SUPER_ADMIN' || (await hasPermission(access.role, 'MANAGE_EXTERNAL_APIS'));
    const skipCache = req.query?.skipCache === '1' || req.query?.skipCache === 'true';
    // catalog=1: return all active global preset APIs (company_id=null) for the selection UI
    const catalogMode = req.query?.catalog === '1' || req.query?.catalog === 'true';
    try {
      const apis = platformScopeRequested && !companyId
        ? (await supabase
            .from('external_api_sources')
            .select('*')
            .order('company_id', { ascending: true, nullsFirst: true })
            .order('created_at', { ascending: true })).data || []
        : catalogMode
          ? (await supabase
              .from('external_api_sources')
              .select('*')
              .is('company_id', null)
              .eq('is_active', true)
              .order('created_at', { ascending: true })).data || []
          : await getPlatformConfigs(companyId, { skipCache });
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
              last_test_status: row.last_test_status ?? null,
              last_test_at: row.last_test_at ?? null,
              last_test_latency_ms: row.last_test_latency_ms ?? null,
            };
            return acc;
          }, {});
        }
      }

      const { data: configRows } = apiIds.length
        ? await supabase
            .from('company_api_configs')
            .select('api_source_id, company_id, daily_limit, signal_limit')
            .eq('enabled', true)
            .in('api_source_id', apiIds)
        : { data: [] };

      const { data: usageRows } = apiIds.length
        ? await supabase
            .from('external_api_usage')
            .select('*')
            .gte('usage_date', sinceDate)
            .in('api_source_id', apiIds)
        : { data: [] };

      const enabledCountMap = (configRows || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.api_source_id] = (acc[row.api_source_id] || 0) + 1;
        return acc;
      }, {});

      const enabledCompaniesByApi = (configRows || []).reduce<Record<string, string[]>>(
        (acc, row) => {
          const companyId = row.company_id;
          if (!companyId) return acc;
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
        // Include all usage (feature + non-feature) so recommendation/campaign-driven API calls show in analytics
        const requestCount = rows.reduce(
          (sum, row) => sum + (row.request_count ?? 0),
          0
        );
        const successCount = rows.reduce(
          (sum, row) => sum + (row.success_count ?? 0),
          0
        );
        const failureCount = rows.reduce(
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
        const usageByCompany = rows.reduce<Record<string, any>>((acc, row) => {
          const parsed = parseUsageUserId(String(row.user_id || ''));
          if (!parsed.companyId) return acc;
          const existing = acc[parsed.companyId] || {
            company_id: parsed.companyId,
            request_count: 0,
            success_count: 0,
            failure_count: 0,
            signals_generated: 0,
            by_feature: {},
            by_user: {},
          };
          existing.request_count += row.request_count ?? 0;
          existing.success_count += row.success_count ?? 0;
          existing.failure_count += row.failure_count ?? 0;
          existing.signals_generated = (existing.signals_generated ?? 0) + (row.signals_generated ?? 0);
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
        const companyConfig = companyId
          ? (configRows || []).find(
              (r: { api_source_id: string; company_id: string }) =>
                r.api_source_id === api.id && r.company_id === companyId
            )
          : null;
        const company_limits =
          companyConfig && companyId
            ? {
                daily_limit: (companyConfig as { daily_limit?: number | null }).daily_limit ?? null,
                signal_limit: (companyConfig as { signal_limit?: number | null }).signal_limit ?? null,
              }
            : null;

        const todayKey = new Date().toISOString().slice(0, 10);
        const companyRows =
          companyId
            ? rows.filter((row) => {
                const parsed = parseUsageUserId(String(row.user_id || ''));
                return parsed.companyId === companyId;
              })
            : [];
        const todayRows = companyRows.filter((row) => String(row.usage_date) === todayKey);
        const usage_today =
          companyId
            ? {
                request_count: todayRows.reduce((s, r) => s + (r.request_count ?? 0), 0),
                signals_generated: todayRows.reduce((s, r) => s + (r.signals_generated ?? 0), 0),
              }
            : null;

        const { oauth_client_id_encrypted, oauth_client_secret_encrypted, ...apiSafe } = api as any;
        return {
          ...apiSafe,
          has_oauth_credentials: !!(oauth_client_id_encrypted && oauth_client_secret_encrypted),
          health: (api as any).health || healthMap[api.id] || null,
          enabled_user_count: enabledCountMap[api.id] || 0,
          enabled_companies: enabledCompaniesByApi[api.id] || [],
          company_limits,
          usage_today,
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
            failure_rate: requestCount > 0 ? Number((failureCount / requestCount).toFixed(3)) : 0,
          },
          usage_by_company: Object.values(usageByCompany).map((entry: any) => ({
            company_id: entry.company_id,
            request_count: entry.request_count,
            success_count: entry.success_count,
            failure_count: entry.failure_count,
            signals_generated: entry.signals_generated ?? 0,
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
              signals_generated: row.signals_generated ?? 0,
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
      return res.status(500).json({
        error: 'Failed to load external APIs',
        detail: error instanceof Error ? error.message : String(error),
      });
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
      oauth_client_id,
      oauth_client_secret,
    } = req.body || {};

    const resolvedPlatformType = platform_type || 'social';

    // Phase 4: Only SUPER_ADMIN can submit OAuth credentials. Tenant users: api_key, base_url, purpose only.
    let oauthClientIdEncrypted: string | null = null;
    let oauthClientSecretEncrypted: string | null = null;
    if (access.role === 'SUPER_ADMIN') {
      if (typeof oauth_client_id === 'string' && oauth_client_id.trim()) {
        try {
          oauthClientIdEncrypted = encryptCredential(oauth_client_id.trim());
        } catch (e) {
          console.warn('OAuth client ID encryption failed:', (e as Error)?.message);
        }
      }
      if (typeof oauth_client_secret === 'string' && oauth_client_secret.trim()) {
        try {
          oauthClientSecretEncrypted = encryptCredential(oauth_client_secret.trim());
        } catch (e) {
          console.warn('OAuth client secret encryption failed:', (e as Error)?.message);
        }
      }
    } else if (
      (typeof oauth_client_id === 'string' && oauth_client_id.trim()) ||
      (typeof oauth_client_secret === 'string' && oauth_client_secret.trim())
    ) {
      return res.status(403).json({
        error: 'OAuth credentials can only be configured by Super Admin. Use Connect Accounts to authorize social media.',
      });
    }
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
        oauth_client_id_encrypted: oauthClientIdEncrypted,
        oauth_client_secret_encrypted: oauthClientSecretEncrypted,
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
      const { oauth_client_id_encrypted: _oid, oauth_client_secret_encrypted: _osec, ...apiSafe } = api as any;
      return res.status(201).json({ api: { ...apiSafe, has_oauth_credentials: !!(_oid && _osec) } });
    }

    const { data, error } = await supabase
      .from('external_api_sources')
      .insert({
        name,
        base_url,
        purpose: purpose || 'posting',
        category: category || null,
        is_active: is_active ?? true,
        method: method || 'GET',
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        api_key_env_name: resolvedApiKeyEnv,
        oauth_client_id_encrypted: oauthClientIdEncrypted,
        oauth_client_secret_encrypted: oauthClientSecretEncrypted,
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
      return res.status(500).json({
        error: 'Failed to create external API',
        detail: error.message,
      });
    }
    const { oauth_client_id_encrypted: _oid, oauth_client_secret_encrypted: _osec, ...apiSafe } = (data || {}) as any;

    // Mark external_api_connected in setup progress and check earn credits (fire-and-forget)
    if (companyId && access?.userId) {
      supabase.from('company_setup_progress').upsert(
        { company_id: companyId, external_api_connected: true, updated_at: new Date().toISOString() },
        { onConflict: 'company_id' },
      ).then(() =>
        checkAndGrantSetupCredits(companyId, access.userId)
          .catch(e => console.warn('[external-apis] setup credits check failed:', e?.message))
      ).catch(() => {});
    }

    return res.status(201).json({ api: { ...apiSafe, has_oauth_credentials: !!(_oid && _osec) } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
