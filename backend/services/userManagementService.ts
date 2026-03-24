import { supabase } from '../db/supabaseClient';
import type { UserContext } from './userContextService';
import { getUserRole, isSuperAdmin, Role } from './rbacService';
import { logUserManagementAudit } from './campaignAuditService';

type AccessResult =
  | { ok: true; scope: 'super_admin' | 'admin' }
  | { ok: false; status: number; error: string };

const requireUserAdminAccess = async (
  requester: UserContext,
  companyId: string
): Promise<AccessResult> => {
  const superAdmin = await isSuperAdmin(requester.userId);
  if (superAdmin) {
    return { ok: true, scope: 'super_admin' };
  }
  const { role, error } = await getUserRole(requester.userId, companyId);
  if (error === 'COMPANY_ACCESS_DENIED') {
    return { ok: false, status: 403, error: 'COMPANY_SCOPE_VIOLATION' };
  }
  if (!role) {
    return { ok: false, status: 403, error: 'ROLE_NOT_ASSIGNED' };
  }
  if (role !== Role.ADMIN) {
    return { ok: false, status: 403, error: 'NOT_AUTHORIZED' };
  }
  return { ok: true, scope: 'admin' };
};

type AuthUser = { id: string; email?: string };
const getOrCreateUserByEmail = async (email: string): Promise<AuthUser> => {
  const normalizedEmail = email.toLowerCase().trim();

  // Look up existing user row by email (DB is the authoritative identity store)
  const { data: existing } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) return { id: (existing as any).id, email: (existing as any).email };

  // Create a stub row — firebase_uid will be populated on first sign-in
  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({ email: normalizedEmail, name: normalizedEmail.split('@')[0] || 'User', created_at: new Date().toISOString() })
    .select('id, email')
    .single();

  if (createError || !created) {
    // Handle race condition
    if (createError?.code === '23505') {
      const { data: retry } = await supabase.from('users').select('id, email').eq('email', normalizedEmail).maybeSingle();
      if (retry) return { id: (retry as any).id, email: (retry as any).email };
    }
    throw new Error(createError?.message || 'Failed to create user');
  }
  return { id: (created as any).id, email: (created as any).email };
};

export const inviteUser = async (
  email: string,
  companyId: string,
  role: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, companyId);
  if (!access.ok) return access;

  const user = await getOrCreateUserByEmail(email);
  const normalizedRole = role.toUpperCase();

  const { data: existing } = await (supabase
    .from('user_company_roles') as any)
    .select('id, role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .limit(1);

  if (existing && existing.length > 0) {
    const existingRow = existing[0];
    if (existingRow.role !== normalizedRole) {
      await supabase
        .from('user_company_roles')
        .update({ role: normalizedRole })
        .eq('id', existingRow.id);
    }
  } else {
    await supabase.from('user_company_roles').insert({
      user_id: user.id,
      company_id: companyId,
      role: normalizedRole,
      created_at: new Date().toISOString(),
    });
  }

  logUserManagementAudit('USER_INVITED', {
    actor_user_id: requester.userId,
    target_user_id: user.id,
    company_id: companyId,
    role: normalizedRole,
  });

  return { ok: true, user_id: user.id, email: user.email, role: normalizedRole };
};

export const listUsers = async (companyId: string, requester: UserContext) => {
  const access = await requireUserAdminAccess(requester, companyId);
  if (!access.ok) return access;

  const { data: roles, error } = await (supabase
    .from('user_company_roles') as any)
    .select('user_id, company_id, role')
    .eq('company_id', companyId);
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_LIST_USERS' };
  }
  const ids = Array.from(new Set((roles || []).map((row: { user_id: string }) => row.user_id)));
  const emailById: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, email')
      .in('id', ids);
    (usersData || []).forEach((u: any) => {
      if (u.id && u.email) emailById[u.id] = u.email;
    });
  }
  const roleMap = (roles || []).reduce((acc: Record<string, string>, row: { user_id: string; role: string }) => {
    acc[row.user_id] = row.role;
    return acc;
  }, {} as Record<string, string>);
  return {
    ok: true,
    users: ids.map((userId: string) => ({
      user_id: userId,
      email: emailById[userId] || null,
      role: roleMap[userId] || null,
    })),
  };
};

export const updateUserRole = async (
  userId: string,
  companyId: string,
  role: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, companyId);
  if (!access.ok) return access;

  const { data, error } = await (supabase
    .from('user_company_roles') as any)
    .update({ role: role.toUpperCase() })
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .select('*')
    .limit(1);
  if (error || !data || data.length === 0) {
    return { ok: false, status: 404, error: 'USER_ROLE_NOT_FOUND' };
  }

  logUserManagementAudit('USER_ROLE_UPDATED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: companyId,
    role: role.toUpperCase(),
  });

  return { ok: true };
};

export const removeUser = async (
  userId: string,
  companyId: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, companyId);
  if (!access.ok) return access;

  const { error } = await (supabase
    .from('user_company_roles') as any)
    .delete()
    .eq('user_id', userId)
    .eq('company_id', companyId);
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_REMOVE_USER' };
  }

  logUserManagementAudit('USER_REMOVED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: companyId,
    role: null,
  });

  return { ok: true };
};
