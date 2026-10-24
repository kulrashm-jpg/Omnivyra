import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/** Route shell — company users API (Agent-B split: helpers/types in ../../../backend/apiHandlers/company/usersShared). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';
import { isNonWorkEmailDomain } from '../../../backend/services/domainEligibilityService';

import { ensureCompanyAccess, ensureCompanyAdminAccess, findOrCreateUserByEmail, insertAuditLog, mapAppRoleToRbac, normalizeInviteRole, readTargetMembership, upsertUserCompanyRole } from '../../../backend/apiHandlers/company/usersShared';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawCompanyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const companyId = typeof rawCompanyId === 'string' ? rawCompanyId.trim() : undefined;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const companyContext = await requireCompanyContext({ req, res, companyId });
  if (!companyContext) return;

  if (req.method === 'GET') {
    const access = await ensureCompanyAccess(req, res, companyId);
    if (!access) return;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { data, error } = await supabase
      .from('user_company_roles')
      .select(
        `
          user_id,
          role,
          status,
          invited_at,
          accepted_at,
          name,
          created_at
        `
      )
      .eq('company_id', companyId)
      ;

    if (error) {
      logger.error('company_users_list_failed', { companyId, message: error.message });
      return res.status(500).json({ error: 'FAILED_TO_LIST_USERS', details: error.message });
    }

    const userIds = (data || [])
      .map((row: any) => row.user_id)
      .filter(Boolean);
    const emailById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users')
        .select('id, email')
        .in('id', userIds);
      (usersData || []).forEach((u: any) => {
        if (u.id && u.email) emailById.set(u.id, u.email);
      });
    }

    const users = (data || []).map((row: any) => {
      const email = emailById.get(row.user_id) || '';
      return {
        user_id: row.user_id,
        email,
        role: row.role,
        status: row.status || 'active',
        invited_at: row.invited_at,
        accepted_at: row.accepted_at,
        name: row.name || (email ? email.split('@')[0] : ''),
        created_at: row.created_at,
      };
    });

    return res.status(200).json({ users });
  }

  if (req.method === 'POST') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { email, role, name } = req.body || {};
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    const desiredRole = normalizeInviteRole(String(role));
    const displayName = name ? String(name).trim() : '';
    const allowedRoles = [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.VIEW_ONLY,
    ];
    if (!(allowedRoles as readonly string[]).includes(desiredRole)) {
      return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
    }

    // Bible rule: work email only. Company-admin-initiated invites (any role)
    // must use a work email — no personal/free (gmail, outlook…) or disposable
    // domains. SUPER_ADMIN is the deliberate backend override escape hatch.
    if (access.role !== Role.SUPER_ADMIN && (await isNonWorkEmailDomain(normalizedEmail.split('@')[1] ?? ''))) {
      return res.status(400).json({
        error: 'PERSONAL_EMAIL_NOT_ALLOWED',
        details: 'Team members must be invited with a work email address, not a personal or disposable one.',
      });
    }

    try {
      if (desiredRole === Role.COMPANY_ADMIN && access.role !== Role.SUPER_ADMIN) {
        const { count: activeAdminCount } = await supabase
          .from('user_company_roles')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('role', Role.COMPANY_ADMIN)
          .eq('status', 'active');

        if ((activeAdminCount ?? 0) > 0) {
          return res.status(409).json({
            error: 'ADMIN_TRANSFER_REQUIRED',
            details: 'This company already has an active company admin. Transfer admin access instead of creating a second admin.',
          });
        }
      }

      // 1. Domain enforcement: COMPANY_ADMIN must use the company's work email domain.
      //    SUPER_ADMIN callers are exempt.
      if (desiredRole === Role.COMPANY_ADMIN && access.role !== Role.SUPER_ADMIN) {
        const { data: companyRow } = await supabase
          .from('companies')
          .select('admin_email_domain, website_domain')
          .eq('id', companyId)
          .maybeSingle();

        const emailDomain = normalizedEmail.split('@')[1] ?? '';
        const allowedDomain =
          (companyRow as any)?.admin_email_domain ||
          (companyRow as any)?.website_domain ||
          null;

        if (allowedDomain && emailDomain !== allowedDomain) {
          return res.status(400).json({
            error: 'INVALID_WORK_EMAIL_DOMAIN',
            details: `A company admin must use a ${allowedDomain} email address.`,
          });
        }
      }

      // 2. Find or create user row by email (auth identity is established by Supabase
      //    on first sign-in; this stub gets linked via supabase_uid then).
      const { id: invitedUserId, error: userErr } = await findOrCreateUserByEmail(normalizedEmail);
      if (userErr === 'ACCOUNT_DELETED') {
        return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' } as any);
      }
      if (userErr || !invitedUserId) {
        return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: userErr } as any);
      }

      // Closure-015I (review R-2) — an existing SUPER_ADMIN membership of the
      // invitee in this company (any status) is platform authority: this
      // company-scoped invite must not rewrite its role or reset it to 'invited'.
      // Refused before the upsert and before any invitation is created or sent.
      const existingMembership = await readTargetMembership(invitedUserId, companyId);
      if (existingMembership.ok !== true && existingMembership.status === 503) {
        return res.status(503).json({ error: existingMembership.error });
      }
      if (existingMembership.ok === true && existingMembership.privileged) {
        await insertAuditLog({
          actorUserId: access.userId,
          action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED',
          targetUserId: invitedUserId,
          companyId,
          metadata: { operation: 'INVITE_USER', requested_role: desiredRole },
        });
        return res.status(403).json({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
      }

      // 3. Upsert role to invited + send invitation. Existing-user fast-path
      //    (auto-add without invite) was removed: it depended on firebase_uid
      //    which was dropped in 20260407_drop_firebase_uid.sql, so the gate was
      //    permanently false. All adds now flow through the invite.

      const { error: upsertError, code: upsertCode } = await upsertUserCompanyRole(
        invitedUserId,
        companyId,
        desiredRole,
        displayName
      );
      // Closure-015J (R-13): an active member is not re-invited (no reset, no
      // invitation); a membership that changed since it was read is not overwritten.
      if (upsertCode === 'ALREADY_ACTIVE_MEMBER' || upsertCode === 'STALE_MEMBERSHIP') {
        return res.status(409).json({ error: upsertCode });
      }
      if (upsertCode === 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE') {
        return res.status(403).json({ error: upsertCode });
      }
      if (upsertError) {
        return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: upsertError });
      }

      const invitation = await createAndSendInvitation({
        email: normalizedEmail,
        companyId,
        role: desiredRole,
        invitedBy: access.userId,
        idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
      });

      await insertAuditLog({
        actorUserId: access.userId,
        action: 'INVITE_USER',
        targetUserId: invitedUserId,
        companyId,
        metadata: { invitationId: invitation.id },
      });

      return res.status(201).json({ success: true, invitationId: invitation.id });
    } catch (error: any) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'INVITE_FAILED',
        companyId,
        metadata: { error: error?.message || 'FAILED_TO_INVITE_USER' },
      });
      return res.status(400).json({ error: error?.message || 'FAILED_TO_INVITE_USER' });
    }
  }

  if (req.method === 'PUT') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { userId, role, status } = req.body || {};
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }
    const desiredRole = normalizeInviteRole(String(role));
    const allowedRoles = [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.VIEW_ONLY,
    ];
    if (!(allowedRoles as readonly string[]).includes(desiredRole)) {
      return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
    }
    // Closure-015I (H-2) — status, when given, must be one of the values the
    // user_company_roles_status_check constraint accepts. Anything else (e.g. the
    // former 'deactivated', a non-string, an empty string) is a client error,
    // answered before any read or write instead of surfacing as a 500 from the DB.
    const MEMBERSHIP_STATUSES = ['invited', 'active', 'inactive', 'expired'] as const;
    if (status !== undefined && status !== null && (typeof status !== 'string' || !(MEMBERSHIP_STATUSES as readonly string[]).includes(status))) {
      return res.status(400).json({ error: 'INVALID_STATUS', allowed: MEMBERSHIP_STATUSES });
    }

    if (!(await hasPermission(access.role, 'ASSIGN_ROLE'))) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PERMISSION_DENIED',
        targetUserId: userId,
        companyId,
        metadata: { action: 'ASSIGN_ROLE' },
      });
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    // Closure-015G — read the target membership BEFORE any write. A SUPER_ADMIN
    // row (any status) is never changed here — not demoted, not deactivated, not
    // re-activated — whoever calls; platform authority stays on the governed
    // identity paths (identity.admin.assign / identity.admin.revoke, step-up).
    const target = await readTargetMembership(String(userId), companyId);
    if (target.ok !== true) return res.status(target.status).json({ error: target.error });
    if (target.privileged) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED',
        targetUserId: String(userId),
        companyId,
        metadata: { operation: 'UPDATE_USER_ROLE', requested_role: desiredRole, requested_status: status || null },
      });
      return res.status(403).json({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' });
    }

    // Closure-015H (G-5) + Closure-015I (H-1) — a company-scoped PUT never
    // ACTIVATES a membership: an INVITED membership becomes active only by
    // accepting its invitation (team/accept-invite, activate_invitation_membership),
    // an EXPIRED one only through a new invitation (reinvite), and an INACTIVE one
    // only through a governed path (a new invitation, or the platform super-admin
    // PATCH /api/super-admin/users with identity.admin.assign + step-up). Role
    // changes, deactivation and status: 'active' on an already-active membership
    // (a no-op) are unaffected.
    if (status === 'active' && target.row.status !== 'active') {
      if (target.row.status === 'invited' || target.row.status === 'expired') {
        return res.status(409).json({ error: 'INVITATION_ACCEPTANCE_REQUIRED' });
      }
      return res.status(409).json({ error: 'REACTIVATION_REQUIRES_GOVERNED_PATH' });
    }

    const updates: Record<string, any> = {
      role: desiredRole,
      updated_at: new Date().toISOString(),
    };

    if (desiredRole === Role.COMPANY_ADMIN && access.role !== Role.SUPER_ADMIN) {
      const { data: anotherAdmin } = await supabase
        .from('user_company_roles')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('role', Role.COMPANY_ADMIN)
        .eq('status', 'active')
        .neq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (anotherAdmin) {
        return res.status(409).json({
          error: 'ADMIN_TRANSFER_REQUIRED',
          details: 'This company already has an active company admin. Reassign the current admin before promoting another user.',
        });
      }
    }
    if (status) {
      updates.status = status;
      if (status === 'inactive') {
        updates.deactivated_at = new Date().toISOString();
      }
      // Closure-015I (H-1): no accepted_at stamp — this route never activates a
      // membership (above), so status 'active' only reaches an already-active row,
      // whose real acceptance time must not be overwritten.
    }

    // Closure-015G — compare-and-set on the membership read above (id, role,
    // status): a concurrent promotion to SUPER_ADMIN (or any other concurrent
    // change) makes this match nothing → 409, never an overwrite.
    let update = supabase
      .from('user_company_roles')
      .update(updates)
      .eq('id', target.row.id)
      .eq('role', target.row.role);
    update = target.row.status === null ? update.is('status', null) : update.eq('status', target.row.status);
    const { data: updatedRows, error } = await update.select('id');

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_ROLE', details: error.message });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return res.status(409).json({ error: 'STALE_MEMBERSHIP' });
    }

    await insertAuditLog({
      actorUserId: access.userId,
      action: status === 'inactive' ? 'DEACTIVATE_USER' : 'UPDATE_USER_ROLE',
      targetUserId: userId,
      companyId,
      metadata: { role: desiredRole, status: status || null },
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!(await hasPermission(access.role, 'ASSIGN_ROLE'))) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PERMISSION_DENIED',
        targetUserId: userId,
        companyId,
        metadata: { action: 'REMOVE_USER' },
      });
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    // Closure-015G — read the target membership BEFORE deleting. A SUPER_ADMIN
    // row (any status) is never removed here, whoever calls; revocation is the
    // governed identity.admin.revoke path.
    const target = await readTargetMembership(String(userId), companyId);
    if (target.ok !== true) return res.status(target.status).json({ error: target.error });
    if (target.privileged) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED',
        targetUserId: String(userId),
        companyId,
        metadata: { operation: 'REMOVE_USER' },
      });
      return res.status(403).json({ error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' });
    }

    // Conditional on the row read (id, role, status — Closure-015H G-3): a
    // concurrent promotion to SUPER_ADMIN or a concurrent status change makes
    // this delete nothing → 409.
    let removal = supabase
      .from('user_company_roles')
      .delete()
      .eq('id', target.row.id)
      .eq('role', target.row.role);
    removal = target.row.status === null ? removal.is('status', null) : removal.eq('status', target.row.status);
    const { data: deletedRows, error } = await removal.select('id');

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_REMOVE_USER', details: error.message });
    }
    if (!deletedRows || deletedRows.length === 0) {
      return res.status(409).json({ error: 'STALE_MEMBERSHIP' });
    }

    await insertAuditLog({
      actorUserId: access.userId,
      action: 'REMOVE_USER',
      targetUserId: userId,
      companyId,
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(withIdempotency(handler, { scope: 'company-users', methods: ['POST', 'PUT', 'DELETE'] }), { route: '/api/company/users' });
