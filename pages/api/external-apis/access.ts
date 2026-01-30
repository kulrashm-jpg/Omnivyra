import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getEnabledApis, getUserApiAccess } from '../../../backend/services/externalApiService';
import { resolveUserContext } from '../../../backend/services/userContextService';

const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) {
    return res.status(400).json({ error: 'User context unavailable' });
  }

  if (req.method === 'GET') {
    try {
      const sources = await getEnabledApis();
      const accessRows = await getUserApiAccess(user.userId);
      const accessMap = accessRows.reduce<Record<string, any>>((acc, row) => {
        acc[row.api_source_id] = row;
        return acc;
      }, {});

      const since = new Date();
      since.setDate(since.getDate() - 13);
      const sinceDate = since.toISOString().slice(0, 10);
      const { data: usageRows } = await supabase
        .from('external_api_usage')
        .select('*')
        .eq('user_id', user.userId)
        .gte('usage_date', sinceDate);

      const usageByApi = (usageRows || []).reduce<Record<string, any[]>>((acc, row) => {
        acc[row.api_source_id] = acc[row.api_source_id] || [];
        acc[row.api_source_id].push(row);
        return acc;
      }, {});

      const apis = sources.map((source) => {
        const rows = usageByApi[source.id] || [];
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

      return res.status(200).json({ apis });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to load external API access' });
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const {
      api_source_id,
      is_enabled,
      api_key_env_name,
      headers_override,
      query_params_override,
      rate_limit_per_min,
    } = req.body || {};

    if (!api_source_id) {
      return res.status(400).json({ error: 'api_source_id is required' });
    }

    const payload = {
      api_source_id,
      user_id: user.userId,
      is_enabled: typeof is_enabled === 'boolean' ? is_enabled : false,
      api_key_env_name: api_key_env_name ? String(api_key_env_name).trim() : null,
      headers_override: normalizeRecord(headers_override),
      query_params_override: normalizeRecord(query_params_override),
      rate_limit_per_min: typeof rate_limit_per_min === 'number' ? rate_limit_per_min : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('external_api_user_access')
      .upsert(payload, { onConflict: 'api_source_id,user_id' })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update API access' });
    }

    return res.status(200).json({ access: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
