/** company users API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { requireCompanyContext } from '../../services/companyContextGuardService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isSuperAdmin,
  Role,
} from '../../services/rbacService';
import { createAndSendInvitation } from '../../services/invitationService';
import { withIdempotency } from '../../middleware/withIdempotency';
import { logger } from '../../services/logger';
import { normalizeRole } from '../../services/rbacPrimitives';

export const mapAppRoleToRbac = (role: string): Role | null => {
  const normalized = role.toUpperCase();
  if (normalized === 'COMPANY_ADMIN') return Role.COMPANY_ADMIN;
  if (normalized === 'USER') return Role.CONTENT_CREATOR;
  return null;
};

export const ensureCompanyAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: Role | null } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id, role: Role.SUPER_ADMIN };
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
  if (roleError) {
    res.status(403).json({ error: roleError === 'COMPANY_ACCESS_DENIED' ? 'COMPANY_ACCESS_DENIED' : 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }

  return { userId: user.id, role };
};

export const ensureCompanyAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: Role } | null> => {
  const access = await ensureCompanyAccess(req, res, companyId);
  if (!access) return null;
  if (access.role === Role.SUPER_ADMIN) {
    return { userId: access.userId, role: Role.SUPER_ADMIN };
  }
  if (!access.role || !(await hasPermission(access.role, 'CREATE_USER'))) {
    try {
      await supabase.from('audit_logs').insert({
        actor_user_id: access.userId,
        action: 'PERMISSION_DENIED',
        company_id: companyId,
        metadata: { action: 'CREATE_USER' },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('company_users_permission_denied_audit_failed', {
        actorUserId: access.userId,
        companyId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    res.status(403).json({ error: 'PERMISSION_DENIED' });
    return null;
  }
  return { userId: access.userId, role: access.role };
};

export const findOrCreateUserByEmail = async (email: string): Promise<{ id: string; error: string | null }> => {
  // Check for a soft-deleted user BEFORE attempting to create (unique constraint on email).
  const { data: existing, error: selectErr } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (selectErr) return { id: '', error: selectErr.message };

  if (existing) {
    // Block re-invite of deleted accounts — the admin must contact support to restore.
    if ((existing as any).is_deleted) {
      return { id: '', error: 'ACCOUNT_DELETED' };
    }
    return { id: (existing as any).id, error: null };
  }

  const { data: created, error: insertErr } = await supabase
    .from('users')
    .insert({
      email:              email.toLowerCase(),
      name:               email.split('@')[0] || 'User',
      is_email_verified:  false,
      is_phone_verified:  false,
      created_at:         new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Race condition — re-fetch (and re-check is_deleted)
      const { data: retry } = await supabase
        .from('users')
        .select('id, is_deleted')
        .eq('email', email.toLowerCase())
        .maybeSingle();
      if (retry) {
        if ((retry as any).is_deleted) return { id: '', error: 'ACCOUNT_DELETED' };
        return { id: (retry as any).id, error: null };
      }
    }
    return { id: '', error: insertErr.message };
  }
  return { id: (created as any).id, error: null };
};

export const normalizeInviteRole = (role: string) => {
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'CONTENT_MANAGER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_PLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_ENGAGER') return Role.VIEW_ONLY;
  if (upper === 'VIEWER') return Role.VIEW_ONLY;
  return upper;
};

/**
 * Closure-015J (R-13) — re-inviting must never reset an ACTIVE member. Every
 * membership row of the user in this company is read (the only uniqueness is the
 * partial index on active rows, so a user may hold an active row next to stale
 * ones); an active row refuses the invite (ALREADY_ACTIVE_MEMBER — role changes of
 * active members go through the governed role routes). A non-active row (invited,
 * expired, inactive) is re-invited as before, but only by a conditional write on
 * id + role + status as read: a concurrent activation / role change in between
 * makes it STALE_MEMBERSHIP instead of being overwritten. A SUPER_ADMIN row is
 * never rewritten (backstop for the route-level Closure-015I R-2 check).
 */
export type UpsertUserCompanyRoleError =
  | 'ALREADY_ACTIVE_MEMBER'
  | 'STALE_MEMBERSHIP'
  | 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE';

export const upsertUserCompanyRole = async (
  userId: string,
  companyId: string,
  role: string,
  name?: string | null
): Promise<{ error: string | null; code?: UpsertUserCompanyRoleError }> => {
  const { data: existing, error: existingError } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (existingError) {
    return { error: existingError.message };
  }

  const rows = ((existing ?? []) as Array<{ id: string; role: string | null; status: string | null }>)
    .map((r) => ({ id: r.id, role: r.role, status: r.status }));
  if (rows.some((r) => String(r.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN')) {
    return { error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE', code: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' };
  }
  if (rows.some((r) => r.status === 'active')) {
    return { error: 'ALREADY_ACTIVE_MEMBER', code: 'ALREADY_ACTIVE_MEMBER' };
  }

  if (rows.length > 0) {
    const row = rows[0];
    const updates: Record<string, any> = {
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (name) {
      updates.name = name;
    }
    let write = supabase.from('user_company_roles').update(updates).eq('id', row.id);
    write = row.role === null ? write.is('role', null) : write.eq('role', row.role);
    write = row.status === null ? write.is('status', null) : write.eq('status', row.status);
    const { data: written, error } = await write.select('id');
    if (error) {
      return { error: error.message };
    }
    if (!written || written.length === 0) {
      return { error: 'STALE_MEMBERSHIP', code: 'STALE_MEMBERSHIP' };
    }
    return { error: null };
  }

  const { error } = await supabase.from('user_company_roles').insert({
    user_id: userId,
    company_id: companyId,
    role,
    created_at: new Date().toISOString(),
    status: 'invited',
    invited_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name: name || null,
  });
  if (error) {
    return { error: error.message };
  }
  return { error: null };
};

/**
 * Closure-015G — the target membership a company-scoped mutation acts on, read
 * BEFORE any write. A SUPER_ADMIN row (any status) is platform authority: a
 * company-scoped route never changes or removes it, whoever calls — grant and
 * revocation are identity.admin.assign / identity.admin.revoke (governed,
 * step-up). The returned snapshot is what the caller's conditional write must
 * still match, so a concurrent promotion to SUPER_ADMIN is never overwritten.
 */
export type TargetMembership = { id: string; role: string; status: string | null };
export type TargetMembershipLookup =
  | { ok: true; row: TargetMembership; privileged: boolean }
  | { ok: false; status: 404 | 503; error: 'MEMBERSHIP_NOT_FOUND' | 'MEMBERSHIP_LOOKUP_FAILED' };
export const readTargetMembership = async (userId: string, companyId: string): Promise<TargetMembershipLookup> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);
  if (error) return { ok: false, status: 503, error: 'MEMBERSHIP_LOOKUP_FAILED' };
  const found = (data ?? [])[0] as { id: string; role: string; status?: string | null } | undefined;
  if (!found) return { ok: false, status: 404, error: 'MEMBERSHIP_NOT_FOUND' };
  // Snapshot the values the conditional write compares against, at read time.
  const row: TargetMembership = { id: found.id, role: found.role, status: found.status ?? null };
  return { ok: true, row, privileged: normalizeRole(row.role) === Role.SUPER_ADMIN };
};

export const insertAuditLog = async (input: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, any>;
}) => {
  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_user_id: input.targetUserId || null,
    company_id: input.companyId || null,
    metadata: input.metadata || null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    logger.error('company_users_audit_log_failed', { actorUserId: input.actorUserId, action: input.action, companyId: input.companyId, message: error.message });
    throw new Error(`AUDIT_LOG_FAILED:${error.message}`);
  }
};

