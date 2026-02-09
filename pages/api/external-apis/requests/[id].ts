import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { saveTenantPlatformConfig } from '../../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import {
  getUserRole,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../../backend/services/rbacService';
import { getLegacySuperAdminSession } from '../../../../backend/services/superAdminSession';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Request ID is required' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const legacySession = getLegacySuperAdminSession(req);
  const { user, error: userError } = legacySession
    ? { user: { id: legacySession.userId }, error: null }
    : await getSupabaseUserFromRequest(req);
  if (userError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
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
  let canManageExternalApis = false;
  if (legacySession) {
    canManageExternalApis = true;
  } else {
    const platformAdmin = await isPlatformSuperAdmin(user.id);
    if (platformAdmin) {
      canManageExternalApis = true;
    } else if (await isSuperAdmin(user.id)) {
      console.debug('SUPER_ADMIN_FALLBACK', {
        path: req.url,
        userId: user.id,
        source: 'rbacService.isSuperAdmin',
      });
      canManageExternalApis = true;
    } else {
      if (!companyId) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
      const { role, error: roleError } = await getUserRole(user.id, companyId);
      if (roleError || !role || !(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
      canManageExternalApis = true;
    }
  }
  if (!canManageExternalApis) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const { status, rejection_reason } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(String(status || ''))) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data: requestRow, error: requestError } = await supabase
    .from('external_api_source_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (requestError || !requestRow) {
    return res.status(404).json({ error: 'Request not found' });
  }

  if (status === 'approved') {
    if (requestRow.status !== 'approved') {
      const tenantCompanyId = requestRow.company_id || companyId;
      if (!tenantCompanyId) {
        return res.status(400).json({ error: 'companyId required' });
      }
      await saveTenantPlatformConfig({
        name: requestRow.name,
        base_url: requestRow.base_url,
        purpose: requestRow.purpose,
        category: requestRow.category,
        is_active: requestRow.is_active ?? true,
        method: requestRow.method || 'GET',
        auth_type: requestRow.auth_type || 'none',
        api_key_env_name: requestRow.api_key_env_name || null,
        headers: requestRow.headers || {},
        query_params: requestRow.query_params || {},
        is_preset: false,
        platform_type: requestRow.platform_type || 'social',
        supported_content_types: requestRow.supported_content_types || [],
        promotion_modes: requestRow.promotion_modes || [],
        required_metadata: requestRow.required_metadata || {},
        posting_constraints: requestRow.posting_constraints || {},
        requires_admin: requestRow.requires_admin ?? true,
        company_id: tenantCompanyId,
      });
    }

    const { error: updateError } = await supabase
      .from('external_api_source_requests')
      .update({
        status: 'approved',
        approved_by_user_id: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to approve request' });
    }
    return res.status(200).json({ status: 'approved' });
  }

  const { error: rejectError } = await supabase
    .from('external_api_source_requests')
    .update({
      status,
      approved_by_user_id: user.id,
      approved_at: new Date().toISOString(),
      rejection_reason: status === 'rejected' ? rejection_reason || null : null,
      rejected_at: status === 'rejected' ? new Date().toISOString() : null,
    })
    .eq('id', id);

  if (rejectError) {
    return res.status(500).json({ error: 'Failed to update request status' });
  }

  return res.status(200).json({ status });
}

export default handler;
