import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { saveTenantPlatformConfig } from '../../../../backend/services/externalApiService';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isSuperAdmin,
  isPlatformSuperAdmin,
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
    // isPlatformSuperAdmin and isSuperAdmin are equivalent (both check SUPER_ADMIN)
    if (await isSuperAdmin(user.id)) {
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

  /*
   * EXTERNAL-API-REQUEST-SEC-001 — the permission was checked against a company
   * the CALLER names; the resource was then selected by id alone.
   *
   * `companyId` comes from `?companyId=`, `body.companyId`, or the caller's
   * default. The role gate above proves MANAGE_EXTERNAL_APIS in THAT company —
   * which a company admin legitimately has in their own. The request row was
   * then fetched with `.eq('id', id)` and no tenant predicate, and every
   * mutation below updates `.eq('id', id)` the same way. So a company admin of
   * A could name their own company to pass the gate and then approve, reject,
   * approve_by_admin or send_to_super_admin any OTHER company's request.
   *
   * Approve is the sharpest: it calls saveTenantPlatformConfig with
   * `company_id: requestRow.company_id`, provisioning an external API source
   * into the victim's tenant. Reject writes a caller-supplied
   * `rejection_reason` into the victim's row.
   *
   * The permission must be held in the company that OWNS the request, not in
   * one the caller nominates. A row with no company_id has no tenant owner, so
   * only a platform/super admin may act on it.
   *
   * Answered as 404 — byte-identical to the not-found response above — so a
   * foreign id is indistinguishable from a non-existent one. That is the
   * no-existence-oracle convention MEDIA-SEC-001 established for this codebase.
   * Nothing is written before this point.
   */
  if (!isSuperAdminUser && (!requestRow.company_id || requestRow.company_id !== companyId)) {
    console.warn('CROSS_TENANT_REQUEST_DENIED', {
      path: req.url,
      userId: user.id,
      authorizedCompanyId: companyId,
    });
    return res.status(404).json({ error: 'Request not found' });
  }

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/external-apis/requests/:id' });
