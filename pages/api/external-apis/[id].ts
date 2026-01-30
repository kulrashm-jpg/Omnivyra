import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { validatePlatformConfig } from '../../../backend/services/externalApiService';
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
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return res.status(500).json({ error: 'Failed to load external API' });
    }
    const { data: healthData } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', id)
      .single();
    return res.status(200).json({ api: { ...data, health: healthData || null } });
  }

  if (req.method === 'PUT') {
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

    let existingRecord: any = null;
    let resolvedPlatformType = platform_type;
    if (!resolvedPlatformType || !auth_type || !api_key_name || !api_key_env_name || !method) {
      const { data: existing } = await supabase
        .from('external_api_sources')
        .select('*')
        .eq('id', id)
        .single();
      existingRecord = existing;
      resolvedPlatformType = resolvedPlatformType ?? existing?.platform_type ?? 'social';
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

    const resolvedAuthType = auth_type ?? existingRecord?.auth_type ?? 'none';
    const resolvedApiKeyName = api_key_name ?? existingRecord?.api_key_name ?? null;
    const resolvedApiKeyEnv = api_key_env_name ?? existingRecord?.api_key_env_name ?? null;
    const resolvedMethod = method ?? existingRecord?.method ?? 'GET';
    const resolvedHeaders = headers ?? existingRecord?.headers ?? {};
    const resolvedQueryParams = query_params ?? existingRecord?.query_params ?? {};
    const resolvedIsPreset = is_preset ?? existingRecord?.is_preset ?? false;
    const resolvedRetryCount = retry_count ?? existingRecord?.retry_count ?? 2;
    const resolvedTimeoutMs = timeout_ms ?? existingRecord?.timeout_ms ?? 8000;
    const resolvedRateLimit = rate_limit_per_min ?? existingRecord?.rate_limit_per_min ?? 60;

    const resolvedKeyEnv = resolvedApiKeyEnv || resolvedApiKeyName || null;

    const { data, error } = await supabase
      .from('external_api_sources')
      .update({
        name,
        base_url,
        purpose,
        category,
        is_active,
        method: resolvedMethod,
        auth_type: resolvedAuthType,
        api_key_name: resolvedApiKeyName,
        api_key_env_name: resolvedKeyEnv,
        headers: resolvedHeaders,
        query_params: resolvedQueryParams,
        is_preset: resolvedIsPreset,
        retry_count: resolvedRetryCount,
        timeout_ms: resolvedTimeoutMs,
        rate_limit_per_min: resolvedRateLimit,
        platform_type: resolvedPlatformType || 'social',
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update external API' });
    }
    return res.status(200).json({ api: data });
  }

  if (req.method === 'DELETE') {
    const isAdmin = await ensureSuperAdmin(req, res);
    if (!isAdmin) return;

    const { error } = await supabase.from('external_api_sources').delete().eq('id', id);
    if (error) {
      return res.status(500).json({ error: 'Failed to delete external API' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
