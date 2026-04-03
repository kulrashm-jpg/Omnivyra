import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { validatePlatformConfig } from '../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../backend/services/rbacService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';

const authTypeRequiresKey = (authType?: string | null) =>
  ['api_key', 'bearer', 'query', 'header'].includes(String(authType || 'none'));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const platformScopeRequested = req.query?.scope === 'platform';
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const legacySession = getLegacySuperAdminSession(req);
  const { user, error } = legacySession ? { user: { id: legacySession.userId }, error: null } : await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (req.method === 'GET') {
    if (platformScopeRequested && !companyId) {
      const platformAdmin = legacySession ? true : await isPlatformSuperAdmin(user.id);
      if (platformAdmin || (await isSuperAdmin(user.id))) {
        const { data, error: listError } = await supabase
          .from('external_api_source_requests')
          .select('*')
          .order('created_at', { ascending: false });
        if (listError) {
          return res.status(500).json({ error: 'Failed to load API requests' });
        }
        return res.status(200).json({ requests: data || [] });
      }
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const platformAdmin = legacySession ? true : await isPlatformSuperAdmin(user.id);
    if (platformAdmin) {
      const createQuery = () =>
        supabase
          .from('external_api_source_requests')
          .select('*')
          .order('created_at', { ascending: false });
      const scopedResult = await createQuery().eq('company_id', companyId);
      if (!scopedResult.error) {
        return res.status(200).json({ requests: scopedResult.data || [] });
      }
      const message = scopedResult.error.message || '';
      if (!message.toLowerCase().includes('company_id')) {
        return res.status(500).json({
          error: 'Failed to load API requests',
          detail: scopedResult.error.message,
        });
      }
      const fallbackResult = await createQuery();
      if (fallbackResult.error) {
        return res.status(500).json({
          error: 'Failed to load API requests',
          detail: fallbackResult.error.message,
        });
      }
      return res.status(200).json({ requests: fallbackResult.data || [] });
    }
    const legacyAdmin = legacySession ? true : await isSuperAdmin(user.id);
    if (legacyAdmin) {
      console.debug('SUPER_ADMIN_FALLBACK', {
        path: req.url,
        userId: user.id,
        source: 'rbacService.isSuperAdmin',
      });
      const { data, error: legacyError } = await supabase
        .from('external_api_source_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (legacyError) {
        return res.status(500).json({
          error: 'Failed to load API requests',
          detail: legacyError.message,
        });
      }
      return res.status(200).json({ requests: data || [] });
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
    const canManage = await hasPermission(role, 'MANAGE_EXTERNAL_APIS');
    const { data, error: requestError } = await supabase
      .from('external_api_source_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (!requestError) {
      const list = (data || []) as Array<{ created_by_user_id?: string | null }>;
      const filtered = canManage
        ? list
        : list.filter((r) => r.created_by_user_id === user.id);
      return res.status(200).json({ requests: filtered });
    }
    const requestMessage = requestError.message || '';
    if (!requestMessage.toLowerCase().includes('company_id')) {
      return res.status(500).json({ error: 'Failed to load API requests' });
    }
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('external_api_source_requests')
      .select('*')
      .eq('created_by_user_id', user.id)
      .order('created_at', { ascending: false });
    if (fallbackError) {
      return res.status(500).json({ error: 'Failed to load API requests' });
    }
    const fallbackList = (fallbackData || []).filter(
      (r: { company_id?: string | null }) => !companyId || r.company_id === companyId
    );
    const fallbackFiltered = canManage ? fallbackList : fallbackList.filter(
      (r: { created_by_user_id?: string | null }) => r.created_by_user_id === user.id
    );
    return res.status(200).json({ requests: fallbackFiltered });
  }

  if (req.method === 'POST') {
    if (!legacySession) {
      const { role, error: roleError } = await getUserRole(user.id, companyId);
      if (roleError || !role) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
    }
    const {
      name,
      base_url,
      purpose,
      category,
      provider,
      connection_type,
      documentation_url,
      sample_response,
      is_active,
      method,
      auth_type,
      api_key_env_name,
      headers,
      query_params,
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

    const resolvedApiKeyEnv = api_key_env_name ? String(api_key_env_name).trim() : null;
    if (authTypeRequiresKey(auth_type) && !resolvedApiKeyEnv) {
      return res.status(400).json({ error: 'API key env var name is required' });
    }

    const insertPayload = {
      name,
      base_url,
      purpose: purpose || 'trends',
      category: category || null,
      provider: provider || null,
      connection_type: connection_type || null,
      documentation_url: documentation_url || null,
      sample_response: sample_response || null,
      is_active: is_active ?? true,
      method: method || 'GET',
      auth_type: auth_type || 'none',
      api_key_env_name: resolvedApiKeyEnv,
      headers: headers || {},
      query_params: query_params || {},
      is_preset: false,
      platform_type: resolvedPlatformType,
      supported_content_types: supported_content_types || [],
      promotion_modes: promotion_modes || [],
      required_metadata: required_metadata || {},
      posting_constraints: posting_constraints || {},
      requires_admin: requires_admin ?? true,
      status: 'pending_admin_review',
      company_id: companyId,
      created_by_user_id: user.id,
      created_at: new Date().toISOString(),
    };
    const insertWithCompany = await supabase
      .from('external_api_source_requests')
      .insert(insertPayload)
      .select('*')
      .single();

    if (!insertWithCompany.error) {
      return res.status(201).json({ request: insertWithCompany.data });
    }
    const insertMessage = insertWithCompany.error.message || '';
    if (!insertMessage.toLowerCase().includes('company_id')) {
      return res.status(500).json({
        error: 'Failed to submit API request',
        detail: insertWithCompany.error.message,
      });
    }
    const insertFallback = await supabase
      .from('external_api_source_requests')
      .insert({
        ...insertPayload,
        company_id: companyId,
      })
      .select('*')
      .single();
    if (insertFallback.error) {
      return res.status(500).json({
        error: 'Failed to submit API request',
        detail: insertFallback.error.message,
      });
    }
    return res.status(201).json({ request: insertFallback.data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
