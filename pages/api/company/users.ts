import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isSuperAdmin,
  Role,
} from '../../../backend/services/rbacService';

const mapAppRoleToRbac = (role: string): Role | null => {
  const normalized = role.toUpperCase();
  if (normalized === 'COMPANY_ADMIN') return Role.COMPANY_ADMIN;
  if (normalized === 'USER') return Role.CONTENT_CREATOR;
  return null;
};

const ensureCompanyAccess = async (
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

const ensureCompanyAdminAccess = async (
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
      console.warn('AUDIT_LOG_FAILED', error);
    }
    res.status(403).json({ error: 'PERMISSION_DENIED' });
    return null;
  }
  return { userId: access.userId, role: access.role };
};

/**
 * Find an existing user row by email, or create a stub row.
 * No supabase.auth calls — users table is the authoritative identity store.
 * firebase_uid will be populated when the user completes their first Firebase sign-in.
 */
const findExistingUserByEmail = async (email: string) => {
  const { data } = await supabase
    .from('users')
    .select('id, email, firebase_uid, is_deleted, created_at')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  // Treat soft-deleted rows as non-existent for invite purposes
  if ((data as any).is_deleted) return null;
  return data;
};

const findOrCreateUserByEmail = async (email: string): Promise<{ id: string; error: string | null }> => {
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

const normalizeInviteRole = (role: string) => {
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'CONTENT_MANAGER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_PLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_ENGAGER') return Role.VIEW_ONLY;
  if (upper === 'VIEWER') return Role.VIEW_ONLY;
  return upper;
};

const upsertUserCompanyRole = async (
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

const insertAuditLog = async (input: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, any>;
}) => {
  try {
    await supabase.from('audit_logs').insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      target_user_id: input.targetUserId || null,
      company_id: input.companyId || null,
      metadata: input.metadata || null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AUDIT_LOG_FAILED', error);
  }
};

const addExistingUserToCompany = async (input: {
  userId: string;
  companyId: string;
  role: string;
  name: string;
  actorUserId: string;
}) => {
  const { error: upsertError } = await upsertUserCompanyRole(
    input.userId,
    input.companyId,
    input.role,
    input.name
  );
  if (upsertError) {
    return { error: 'FAILED_TO_ASSIGN_ROLE', details: upsertError };
  }
  const { error: activateError } = await supabase
    .from('user_company_roles')
    .update({
      status: 'active',
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: input.name || null,
    })
    .eq('user_id', input.userId)
    .eq('company_id', input.companyId);
  if (activateError) {
    return { error: 'FAILED_TO_ACTIVATE_USER', details: activateError.message };
  }
  await insertAuditLog({
    actorUserId: input.actorUserId,
    action: 'ADD_EXISTING_USER',
    targetUserId: input.userId,
    companyId: input.companyId,
  });
  return { error: null };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rawCompanyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const companyId = typeof rawCompanyId === 'string' ? rawCompanyId.trim() : undefined;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

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
      console.warn('FAILED_TO_LIST_USERS', error.message);
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

    try {
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

      // 2. Find or create user row by email (no supabase.auth — Firebase-only)
      const { id: invitedUserId, error: userErr } = await findOrCreateUserByEmail(normalizedEmail);
      if (userErr === 'ACCOUNT_DELETED') {
        return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' } as any);
      }
      if (userErr || !invitedUserId) {
        return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: userErr } as any);
      }

      // 4. Check if user already has an active role in this company
      const existingUser = await findExistingUserByEmail(normalizedEmail);
      if (existingUser && (existingUser as any).firebase_uid) {
        // User has signed in before — add directly without invite flow
        const result = await addExistingUserToCompany({
          userId: invitedUserId,
          companyId,
          role: desiredRole,
          name: displayName,
          actorUserId: access.userId,
        });
        if (result.error) return res.status(500).json(result);
        return res.status(200).json({ message: 'User added to team.' });
      }

      // 5. User exists in DB but has not signed in yet — create/update role + send invite
      const { error: upsertError } = await upsertUserCompanyRole(
        invitedUserId,
        companyId,
        desiredRole,
        displayName
      );
      if (upsertError) {
        return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: upsertError });
      }

      // 4. Issue invitation token and send email
      const { randomBytes, createHash } = await import('crypto');
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 86_400 * 1_000).toISOString();

      await supabase.from('invitations').upsert(
        { email: normalizedEmail, company_id: companyId, role: desiredRole, token_hash: tokenHash,
          invited_by: access.userId, expires_at: expiresAt, accepted_at: null, revoked_at: null },
        { onConflict: 'token_hash' }
      );

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      const inviteLink = `${baseUrl}/auth/accept-invite?token=${rawToken}`;
      // TODO: send email via your mailer (Resend / SendGrid / SES)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV] Invite link for ${normalizedEmail}: ${inviteLink}`);
      }

      await insertAuditLog({
        actorUserId: access.userId,
        action: 'INVITE_USER',
        targetUserId: invitedUserId,
        companyId,
      });

      return res.status(201).json({ success: true });
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

    const updates: Record<string, any> = {
      role: desiredRole,
      updated_at: new Date().toISOString(),
    };
    if (status) {
      updates.status = status;
      if (status === 'inactive' || status === 'deactivated') {
        updates.deactivated_at = new Date().toISOString();
      }
      if (status === 'active') {
        updates.accepted_at = new Date().toISOString();
      }
    }

    const { error } = await supabase
      .from('user_company_roles')
      .update(updates)
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_ROLE', details: error.message });
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

    const { error } = await supabase
      .from('user_company_roles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_REMOVE_USER', details: error.message });
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
