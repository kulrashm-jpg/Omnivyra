import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { externalApiPresets } from '../../../backend/services/externalApiPresets';
import { ExternalApiSource } from '../../../backend/services/externalApiService';
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string | undefined;
  const platformScopeRequested = req.query?.scope === 'platform';
  const access = platformScopeRequested && !companyId
    ? await requirePlatformAdmin(req, res)
    : await requireExternalApiAccess(req, res, companyId, false);
  if (!access) return;

  try {
    if (platformScopeRequested && !companyId) {
      const baseQuery = () =>
        supabase
          .from('external_api_sources')
          .select('*')
          .eq('is_preset', true)
          .order('created_at', { ascending: true });
      const scopedResult = await baseQuery().is('company_id', null);
      if (scopedResult.error && (scopedResult.error.message || '').toLowerCase().includes('is_preset')) {
        return res.status(200).json({
          presets: externalApiPresets,
          hidden_ids: [],
        });
      }
      const resultData = scopedResult.error
        ? (() => {
            const message = scopedResult.error.message || '';
            if (!message.toLowerCase().includes('company_id')) {
              return null;
            }
            return baseQuery();
          })()
        : null;
      const fallbackData = resultData ? await resultData : null;
      if (scopedResult.error && !fallbackData) {
        return res.status(500).json({ error: 'Failed to load presets' });
      }
      const rows = scopedResult.error ? fallbackData?.data || [] : scopedResult.data || [];
      const globalOnly = rows.filter((row: any) => row.company_id == null);
      const dbPresets = globalOnly.map((preset: ExternalApiSource) => ({
        id: preset.id,
        name: preset.name,
        description: preset.category || preset.purpose || 'Custom preset',
        base_url: preset.base_url,
        method: (preset.method || 'GET').toUpperCase() as 'GET' | 'POST',
        headers: (preset.headers || {}) as Record<string, string>,
        query_params: (preset.query_params || {}) as Record<string, string | number>,
        auth_type: preset.auth_type || 'none',
        api_key_env_name: preset.api_key_env_name || preset.api_key_name || null,
        example_response_type: 'json',
        is_preset: true,
      }));
      return res.status(200).json({
        presets: [
          ...externalApiPresets.filter(
            (preset) => !dbPresets.some((dbPreset) => dbPreset.name === preset.name)
          ),
          ...dbPresets,
        ],
        hidden_ids: [],
      });
    }
    if (access.role === 'SUPER_ADMIN') {
      const { data: existingPresets, error: existingError } = await supabase
        .from('external_api_sources')
        .select('id,name,base_url')
        .eq('is_preset', true)
        .eq('company_id', companyId);
      if (existingError && (existingError.message || '').toLowerCase().includes('is_preset')) {
        return res.status(200).json({ presets: externalApiPresets, hidden_ids: [] });
      }
      const existingKeys = new Set(
        (existingPresets || []).map((preset) => `${preset.name}::${preset.base_url}`)
      );
      const missingPresets = externalApiPresets.filter(
        (preset) => !existingKeys.has(`${preset.name}::${preset.base_url}`)
      );
      if (missingPresets.length > 0) {
        await supabase.from('external_api_sources').insert(
          missingPresets.map((preset) => ({
            name: preset.name,
            base_url: preset.base_url,
            purpose: 'trends',
            category: preset.description || null,
            is_active: true,
            method: preset.method || 'GET',
            auth_type: preset.auth_type || 'none',
            api_key_name: null,
            api_key_env_name: preset.api_key_env_name || null,
            headers: preset.headers || {},
            query_params: preset.query_params || {},
            is_preset: true,
            retry_count: 2,
            timeout_ms: 8000,
            rate_limit_per_min: 60,
            platform_type: 'social',
            supported_content_types: [],
            promotion_modes: [],
            required_metadata: {},
            posting_constraints: {},
            requires_admin: true,
            company_id: companyId,
            created_at: new Date().toISOString(),
          }))
        );
      }
    }

    let hiddenIds = new Set<string>();
    const hiddenResult = await supabase
      .from('external_api_user_access')
      .select('api_source_id')
      .eq('user_id', `company:${companyId}`)
      .eq('is_enabled', false);
    if (hiddenResult.error) {
      console.warn('FAILED_TO_LOAD_HIDDEN_PRESETS', hiddenResult.error.message);
    } else {
      hiddenIds = new Set((hiddenResult.data || []).map((row) => row.api_source_id));
    }

    const { data, error } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('is_preset', true)
      .order('created_at', { ascending: true });

    if (error) {
      if ((error.message || '').toLowerCase().includes('is_preset')) {
        return res.status(200).json({ presets: externalApiPresets, hidden_ids: [] });
      }
      console.warn('FAILED_TO_LOAD_PRESET_SOURCES', error.message);
      return res.status(200).json({ presets: externalApiPresets, hidden_ids: [] });
    }

    const dbPresets = (data || []).map((preset: ExternalApiSource) => ({
      id: preset.id,
      name: preset.name,
      description: preset.category || preset.purpose || 'Custom preset',
      base_url: preset.base_url,
      method: (preset.method || 'GET').toUpperCase() as 'GET' | 'POST',
      headers: (preset.headers || {}) as Record<string, string>,
      query_params: (preset.query_params || {}) as Record<string, string | number>,
      auth_type: preset.auth_type || 'none',
      api_key_env_name: preset.api_key_env_name || preset.api_key_name || null,
      example_response_type: 'json',
      is_preset: true,
    }));

    return res.status(200).json({
      presets: [
        ...externalApiPresets.filter(
          (preset) => !dbPresets.some((dbPreset) => dbPreset.name === preset.name)
        ),
        ...dbPresets,
      ],
      hidden_ids: Array.from(hiddenIds),
    });
  } catch (error) {
    console.warn('FAILED_TO_LOAD_PRESETS', error);
    return res.status(200).json({ presets: externalApiPresets, hidden_ids: [] });
  }
}

export default handler;
