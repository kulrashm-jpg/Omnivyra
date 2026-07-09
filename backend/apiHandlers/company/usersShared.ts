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

export const upsertUserCompanyRole = async (
  userId: string,
  companyId: string,
  role: string,
  name?: string | null
) => {
  const { data: existing, error: existingError } = await supabase
    .from('user_company_roles')
    .select('id, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);

  if (existingError) {
    return { error: existingError.message };
  }

  if (existing && existing.length > 0) {
    const row = existing[0];
    const updates: Record<string, any> = {
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (name) {
      updates.name = name;
    }
    if (row.role !== role) {
      updates.role = role;
    }
    const { error } = await supabase.from('user_company_roles').update(updates).eq('id', row.id);
    if (error) {
      return { error: error.message };
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

