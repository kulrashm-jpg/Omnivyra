/** Part of the external-apis API (Agent-B split — backend module, not a route). */
import { requireExternalApiAccess, requirePlatformAdmin, parseUsageUserId } from './indexShared';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import {
  getPlatformConfigs,
  getExternalApiRuntimeSnapshot,
  savePlatformConfig,
  validatePlatformConfig,
  VALID_API_CATEGORIES,
} from '../../services/externalApiService';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../services/rbacService';
import { encryptCredential } from '../../auth/credentialEncryption';
import { checkAndGrantSetupCredits } from '../../services/earnCreditsService';
import { requireCapability } from '../../security/requireCapability';
import { hasCapability } from '../../security/AuthorizationService';
import { resolvePrincipal } from '../../security/IdentityResolver';
import { INTEGRATION_SECRETS_READ } from '../../../shared/contracts/security';
import type { AuthenticatedPrincipal } from '../../../shared/contracts/security';


export async function handleExternalApisGet(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  const companyId =
    (req.query?.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const platformScopeRequested = req.query?.scope === 'platform';
  void companyId; void platformScopeRequested;
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

      // Account counts per API (platform-scope only — tenant view doesn't need this)
      const { data: accountRows } = (platformScopeRequested && !companyId && apiIds.length)
        ? await supabase
            .from('api_provider_accounts')
            .select('api_source_id, is_active')
            .in('api_source_id', apiIds)
        : { data: [] };

      const accountCountMap = (accountRows || []).reduce<Record<string, { total: number; active: number }>>(
        (acc, row) => {
          const entry = acc[row.api_source_id] ?? { total: 0, active: 0 };
          entry.total += 1;
          if (row.is_active) entry.active += 1;
          acc[row.api_source_id] = entry;
          return acc;
        },
        {}
      );

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
        const accountStats = accountCountMap[api.id] ?? { total: 0, active: 0 };
        return {
          ...apiSafe,
          has_oauth_credentials: !!(oauth_client_id_encrypted && oauth_client_secret_encrypted),
          health: (api as any).health || healthMap[api.id] || null,
          account_count: accountStats.total,
          active_account_count: accountStats.active,
          enabled_user_count: enabledCountMap[api.id] || 0,
          enabled_companies: enabledCompaniesByApi[api.id] || [],
          company_limits,
          usage_today,
          usage_summary: {
            request_count: requestCount,
            success_count: successCount,
            failure_count: failureCount,
            signals_generated: signalsGenerated,
            total_usage: requestCount,
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
  return false;
}
