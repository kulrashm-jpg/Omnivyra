import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../backend/services/rbacService';

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
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  return null;
};

const authRequiresKey = (authType?: string | null) =>
  ['api_key', 'bearer', 'query', 'header'].includes(String(authType || 'none'));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requirePlatformAdmin(req, res);
  if (!access) return;

  try {
    const { data: apis } = await supabase
      .from('external_api_sources')
      .select('id, auth_type, api_key_env_name, api_key_name')
      .is('company_id', null)
      .order('created_at', { ascending: true });

    const list = apis || [];
    const apiIds = list.map((api: any) => api.id);
    const LATENCY_WARNING_MS = 2000;
    let healthMap: Record<string, { freshness_score: number; reliability_score: number; last_test_status?: string | null; last_test_at?: string | null; last_test_latency_ms?: number | null }> = {};
    if (apiIds.length > 0) {
      const { data: healthData } = await supabase
        .from('external_api_health')
        .select('*')
        .in('api_source_id', apiIds);
      (healthData || []).forEach((row: any) => {
        healthMap[row.api_source_id] = {
          freshness_score: row.freshness_score ?? 1,
          reliability_score: row.reliability_score ?? 1,
          last_test_status: row.last_test_status ?? null,
          last_test_at: row.last_test_at ?? null,
          last_test_latency_ms: row.last_test_latency_ms ?? null,
        };
      });
    }

    const since = new Date();
    since.setDate(since.getDate() - 13);
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: usageRows } = apiIds.length
      ? await supabase
          .from('external_api_usage')
          .select('api_source_id, request_count, success_count, failure_count, user_id')
          .gte('usage_date', sinceDate)
          .in('api_source_id', apiIds)
      : { data: [] };

    const usageByApi = (usageRows || []).reduce<Record<string, { request_count: number; failure_count: number }>>(
      (acc, row: any) => {
        const uid = String(row.user_id || '');
        if (uid.startsWith('feature:')) return acc;
        acc[row.api_source_id] = acc[row.api_source_id] || { request_count: 0, failure_count: 0 };
        acc[row.api_source_id].request_count += row.request_count ?? 0;
        acc[row.api_source_id].failure_count += row.failure_count ?? 0;
        return acc;
      },
      {}
    );

    let healthy = 0;
    let warning = 0;
    let failed = 0;
    list.forEach((api: any) => {
      const missingEnv = authRequiresKey(api.auth_type) && !(api.api_key_env_name || api.api_key_name);
      if (missingEnv) {
        failed += 1;
        return;
      }
      const health = healthMap[api.id];
      const lastStatus = health?.last_test_status;
      const lastLatencyMs = health?.last_test_latency_ms ?? 0;

      if (lastStatus === 'FAILED') {
        failed += 1;
        return;
      }
      if (lastStatus === 'SUCCESS') {
        if (lastLatencyMs > LATENCY_WARNING_MS) {
          warning += 1;
        } else {
          healthy += 1;
        }
        return;
      }

      const usage = usageByApi[api.id] || { request_count: 0, failure_count: 0 };
      const fr = usage.request_count > 0 ? usage.failure_count / usage.request_count : 0;
      const combined = health
        ? (health.freshness_score ?? 1) * (health.reliability_score ?? 1)
        : 1;
      if (usage.request_count >= 5 && fr > 0.1) {
        failed += 1;
        return;
      }
      if (usage.request_count >= 5 && fr >= 0.02 && fr <= 0.1) {
        warning += 1;
        return;
      }
      if (combined >= 0.75 && (usage.request_count < 5 || fr < 0.02)) {
        healthy += 1;
        return;
      }
      if (combined >= 0.4 || (usage.request_count < 5 && fr < 0.02)) {
        warning += 1;
        return;
      }
      failed += 1;
    });

    const status = failed > 0 ? 'attention' : warning > 0 ? 'attention' : 'healthy';
    return res.status(200).json({
      healthy,
      warning,
      failed,
      status,
    });
  } catch (error) {
    console.error('Health summary error:', error);
    return res.status(500).json({ error: 'Failed to load health summary' });
  }
}
