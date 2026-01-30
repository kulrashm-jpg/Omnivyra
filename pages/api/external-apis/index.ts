import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  getPlatformConfigs,
  validatePlatformConfig,
} from '../../../backend/services/externalApiService';
import { resolveUserContext } from '../../../backend/services/userContextService';

const ensureSuperAdmin = async (req: NextApiRequest, res: NextApiResponse): Promise<boolean> => {
  const user = await resolveUserContext(req);
  const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin', {
    check_user_id: user.userId,
  });
  if (error || !isSuperAdmin) {
    res.status(403).json({
      error: 'Access denied. Only super admins can manage external APIs.',
      code: 'INSUFFICIENT_PRIVILEGES',
    });
    return false;
  }
  return true;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const apis = await getPlatformConfigs();
      const since = new Date();
      since.setDate(since.getDate() - 13);
      const sinceDate = since.toISOString().slice(0, 10);

      const { data: accessRows } = await supabase
        .from('external_api_user_access')
        .select('*')
        .eq('is_enabled', true);

      const { data: usageRows } = await supabase
        .from('external_api_usage')
        .select('*')
        .gte('usage_date', sinceDate);

      const enabledCountMap = (accessRows || []).reduce<Record<string, number>>((acc, row) => {
        acc[row.api_source_id] = (acc[row.api_source_id] || 0) + 1;
        return acc;
      }, {});

      const usageByApi = (usageRows || []).reduce<Record<string, any[]>>((acc, row) => {
        acc[row.api_source_id] = acc[row.api_source_id] || [];
        acc[row.api_source_id].push(row);
        return acc;
      }, {});

      const enriched = apis.map((api) => {
        const rows = usageByApi[api.id] || [];
        const requestCount = rows.reduce((sum, row) => sum + (row.request_count ?? 0), 0);
        const successCount = rows.reduce((sum, row) => sum + (row.success_count ?? 0), 0);
        const failureCount = rows.reduce((sum, row) => sum + (row.failure_count ?? 0), 0);
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
        return {
          ...api,
          enabled_user_count: enabledCountMap[api.id] || 0,
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

      return res.status(200).json({ apis: enriched });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load external APIs' });
    }
  }

  if (req.method === 'POST') {
    const isAdmin = await ensureSuperAdmin(req, res);
    if (!isAdmin) return;

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
