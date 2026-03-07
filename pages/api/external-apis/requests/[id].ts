import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { saveTenantPlatformConfig } from '../../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
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
      let { role, error: roleError } = await getUserRole(user.id, companyId);
      if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
        const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
        if (fallbackRole && (await hasPermission(fallbackRole, 'MANAGE_EXTERNAL_APIS'))) {
          role = fallbackRole;
          roleError = null;
        }
      }
      if (roleError || !role || !(await hasPermission(role, 'MANAGE_EXTERNAL_APIS'))) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }
      canManageExternalApis = true;
    }
  }
  if (!canManageExternalApis) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const { status, action, rejection_reason } = req.body || {};
  const resolvedAction = action || status;
  const validActions = [
    'approve_by_admin',
    'send_to_super_admin',
    'approved_by_admin',
    'sent_to_super_admin',
    'approve',
    'reject',
    'rejected',
    'approved',
    'pending',
    'pending_admin_review',
  ];
  if (resolvedAction && !validActions.includes(String(resolvedAction))) {
    return res.status(400).json({ error: 'Invalid status or action' });
  }

  const { data: requestRow, error: requestError } = await supabase
    .from('external_api_source_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (requestError || !requestRow) {
    return res.status(404).json({ error: 'Request not found' });
  }

  const isSuperAdminUser =
    legacySession || (await isPlatformSuperAdmin(user.id)) || (await isSuperAdmin(user.id));

  const now = new Date().toISOString();

  if (resolvedAction === 'approve' || resolvedAction === 'approved') {
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
        approved_at: now,
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to approve request',
        detail: updateError.message,
      });
    }
    return res.status(200).json({ status: 'approved' });
  }

  if (resolvedAction === 'reject' || resolvedAction === 'rejected') {
    const { error: rejectError } = await supabase
      .from('external_api_source_requests')
      .update({
        status: 'rejected',
        rejection_reason: rejection_reason || null,
        rejected_at: now,
      })
      .eq('id', id);

    if (rejectError) {
      return res.status(500).json({
        error: 'Failed to reject request',
        detail: rejectError.message,
      });
    }
    return res.status(200).json({ status: 'rejected' });
  }

  if (resolvedAction === 'approve_by_admin' || resolvedAction === 'approved_by_admin') {
    if (isSuperAdminUser) {
      return res.status(400).json({
        error: 'Use approve (Super Admin) or send_to_super_admin (company admin)',
      });
    }
    const { error: updateError } = await supabase
      .from('external_api_source_requests')
      .update({
        status: 'approved_by_admin',
        approved_by_admin_at: now,
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to update request',
        detail: updateError.message,
      });
    }
    return res.status(200).json({ status: 'approved_by_admin' });
  }

  if (resolvedAction === 'send_to_super_admin' || resolvedAction === 'sent_to_super_admin') {
    if (isSuperAdminUser) {
      return res.status(400).json({ error: 'Super Admin should use approve or reject' });
    }
    const { error: updateError } = await supabase
      .from('external_api_source_requests')
      .update({
        status: 'sent_to_super_admin',
        sent_to_super_admin_at: now,
      })
      .eq('id', id);

    if (updateError) {
      return res.status(500).json({
        error: 'Failed to update request',
        detail: updateError.message,
      });
    }
    return res.status(200).json({ status: 'sent_to_super_admin' });
  }

  return res.status(400).json({ error: 'Missing status or action' });
}

export default handler;
