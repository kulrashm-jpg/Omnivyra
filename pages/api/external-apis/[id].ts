import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { validatePlatformConfig } from '../../../backend/services/externalApiService';
import { encryptCredential } from '../../../backend/auth/credentialEncryption';
import { invalidateCompanyConfigCacheForApiSource } from '../../../backend/services/companyApiConfigCache';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../backend/services/rbacService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }
  const { defaultCompanyId } = await resolveUserContext(req);
  const platformScopeRequested = req.query?.scope === 'platform';
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (platformScopeRequested ? undefined : defaultCompanyId);
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const legacySession = getLegacySuperAdminSession(req);
  const { user, error: userError } = legacySession
    ? { user: { id: legacySession.userId }, error: null }
    : await getSupabaseUserFromRequest(req);
  if (userError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  let canManageExternalApis = false;
  let hasPlatformScope = false;
  if (legacySession) {
    canManageExternalApis = true;
    hasPlatformScope = true;
  } else {
    const platformAdmin = await isPlatformSuperAdmin(user.id);
    if (platformAdmin) {
      canManageExternalApis = true;
      hasPlatformScope = true;
    } else if (await isSuperAdmin(user.id)) {
      console.debug('SUPER_ADMIN_FALLBACK', {
        path: req.url,
        userId: user.id,
        source: 'rbacService.isSuperAdmin',
      });
      canManageExternalApis = true;
      hasPlatformScope = true;
    } else {
      if (!companyId) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
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
    let query = supabase
      .from('external_api_sources')
      .select('*')
      .eq('id', id);
    if (!platformScopeRequested) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query.single();
    if (error) {
      return res.status(500).json({
        error: 'Failed to load external API',
        detail: error.message,
      });
    }
    const { data: healthData } = await supabase
      .from('external_api_health')
      .select('*')
      .eq('api_source_id', id)
      .single();
    return res.status(200).json({ api: { ...data, health: healthData || null } });
  }

  if (req.method === 'PUT') {
    if (!canManageExternalApis) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
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
      let existingQuery = supabase.from('external_api_sources').select('*').eq('id', id);
      if (!platformScopeRequested && companyId) existingQuery = existingQuery.eq('company_id', companyId);
      const { data: existing } = await existingQuery.single();
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

    let updateQuery = supabase
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
      .eq('id', id);
    if (!platformScopeRequested) {
      updateQuery = updateQuery.eq('company_id', companyId);
    }
    const { data, error } = await updateQuery.select('*').single();

    if (error) {
      return res.status(500).json({
        error: 'Failed to update external API',
        detail: error.message,
      });
    }
    await invalidateCompanyConfigCacheForApiSource(id);
    return res.status(200).json({ api: data });
  }

  if (req.method === 'DELETE') {
    if (!canManageExternalApis) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const deleteQuery = supabase.from('external_api_sources').delete().eq('id', id);
    if (!hasPlatformScope) {
      deleteQuery.eq('company_id', companyId);
    }
    const { error } = await deleteQuery;
    if (error) {
      return res.status(500).json({
        error: 'Failed to delete external API',
        detail: error.message,
      });
    }
    await invalidateCompanyConfigCacheForApiSource(id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
