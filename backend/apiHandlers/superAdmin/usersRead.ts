/** Part of super-admin users API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { Role, ALL_ROLES } from '../../services/rbacService';
import { createAndSendInvitation } from '../../services/invitationService';
import { requireAdminRateLimit } from '../../services/requestAccessService';
import { withIdempotency } from '../../middleware/withIdempotency';
import { logger } from '../../services/logger';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { saveDomainRecord, reassignDomain } from '../../services/domainRecordService';
import { insertAuditLogStrict, SYSTEM_USER_ID } from '../../services/auditActorService';
import { logDomainUnverifiedUsageForCompany } from '../../services/domainVerificationService';
import { requireCapability } from '../../security/requireCapability';
import {
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_DELETE,
  SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';

const ALLOWED_OVERRIDE_TYPES = ['no_website', 'domain_exception', 'manual_assignment'] as const;
import { OverrideType, isAllowedOverrideType, requireSuperAdminAccess, allowedRoles, isAllowedRole, findOrCreateUserByEmail, optionalRoleColumns, upsertUserCompanyRole, insertAuditLog } from './usersShared';

export async function handleUsersGet(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('user_id, role, company_id, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('super_admin_users_list_failed', { message: error.message });
      return res.status(500).json({
        error: 'FAILED_TO_LIST_USERS',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }

    const rows = data || [];
    const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));

    const [usersResult, companiesResult, profilesResult] = await Promise.all([
      // Phase 2.B — surface users.status so the super-admin UI can show
      // suspended/invited/deleted lifecycle state distinct from the
      // user_company_roles.status the existing UI already displays.
      supabase.from('users').select('id, email, status, created_at').eq('is_deleted', false),
      companyIds.length > 0
        ? supabase.from('companies').select('id, name').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length > 0
        ? supabase.from('company_profiles').select('company_id, name').in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_USERS', details: usersResult.error.message });
    }
    if (companiesResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES', details: companiesResult.error.message });
    }

    // No Supabase auth.admin.listUsers() fallback — users table is the authoritative source
    const authFallbackUsers: Array<{ id: string; email: string; created_at?: string | null }> = [];

    const emailByUserId = [...(usersResult.data || []), ...authFallbackUsers].reduce<Record<string, string>>(
      (acc, user) => {
        acc[user.id] = user.email || '';
        return acc;
      },
      {}
    );
    // Phase 2.B — lifecycle status by users.id, keyed for fast row lookup.
    const accountStatusByUserId = (usersResult.data || []).reduce<Record<string, string | null>>(
      (acc, user) => {
        acc[(user as any).id] = ((user as any).status as string | null) ?? null;
        return acc;
      },
      {},
    );
    const nameByCompanyId = (companiesResult.data || []).reduce<Record<string, string>>((acc, company) => {
      acc[company.id] = company.name || '';
      return acc;
    }, {});
    if (profilesResult.data) {
      profilesResult.data.forEach((profile) => {
        if (profile.company_id && !nameByCompanyId[profile.company_id]) {
          nameByCompanyId[profile.company_id] = profile.name || '';
        }
      });
    }

    const usersFromRoles = rows.map((row) => ({
      user_id: row.user_id,
      email: emailByUserId[row.user_id] || '',
      role: row.role,
      status: row.status || null,
      account_status: accountStatusByUserId[row.user_id] ?? null,
      company_id: row.company_id,
      company_name: nameByCompanyId[row.company_id] || '',
      created_at: row.created_at,
    }));

    const roleUserIds = new Set(usersFromRoles.map((row) => row.user_id));
    const standaloneUsers = [...(usersResult.data || []), ...authFallbackUsers]
      .filter((user) => user.id && !roleUserIds.has(user.id))
      .map((user) => ({
        user_id: user.id,
        email: user.email || '',
        role: 'UNASSIGNED',
        status: null,
        account_status: accountStatusByUserId[user.id] ?? null,
        company_id: null,
        company_name: '',
        created_at: user.created_at || null,
      }));

    const users = [...usersFromRoles, ...standaloneUsers].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );

    return res.status(200).json({ users });
  }
  return false;
}

export async function handleUsersPatch(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  if (req.method === 'PATCH') {
    const { userId, companyId, status, role } = req.body || {};

    // Validate required parameters
    if (!userId) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'userId is required to update a user',
        required_fields: ['userId', 'companyId']
      });
    }
    if (!companyId) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'companyId is required to update a user',
        required_fields: ['userId', 'companyId']
      });
    }

    // Wave 2C-B: capability + step-up gate.
    const patchGuard = await requireCapability(req, res, {
      capability: IDENTITY_ADMIN_ASSIGN,
      reason: `super-admin updates user role/status (target=${userId})`,
      organizationId: companyId,
      resourceId: userId,
    });
    if (patchGuard.ok !== true) return;
    if (!status && !role) {
      return res.status(400).json({ 
        error: 'MISSING_UPDATE_FIELDS',
        details: 'Either status or role must be provided',
        acceptable_fields: ['status', 'role']
      });
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    let normalizedStatus: string | null = null;
    if (status) {
      normalizedStatus = String(status);
      if (!['active', 'inactive'].includes(normalizedStatus)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
      }
      updatePayload.status = normalizedStatus;
      if (normalizedStatus === 'inactive') {
        updatePayload.deactivated_at = new Date().toISOString();
      } else {
        updatePayload.deactivated_at = null;
      }
    }
    if (role) {
      const normalizedRole = String(role).toUpperCase();
      if (!isAllowedRole(normalizedRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }
      updatePayload.role = normalizedRole;
    }

    const { data, error } = await supabase
      .from('user_company_roles')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .select('user_id, company_id, status, role')
      .maybeSingle();

    if (error) {
      logger.error('super_admin_users_patch_failed', { userId, companyId, message: error.message });
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_USER', details: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', details: `No role record found for user ${userId} in company ${companyId}` });
    }

    await insertAuditLog({
      actorUserId: null,
      action: 'SUPER_ADMIN_USER_UPDATE',
      targetUserId: userId,
      companyId,
      metadata: {
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(updatePayload.role ? { role: updatePayload.role } : {}),
      },
    });
    if (updatePayload.role) {
      void logAuthEvent('role_changed', {
        userId,
        metadata: { new_role: updatePayload.role, company_id: companyId, changed_by: 'super_admin' },
      });
    }

    return res.status(200).json({ user: data });
  }
  return false;
}
