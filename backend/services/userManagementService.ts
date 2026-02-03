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

const ensureAuthAdmin = () => {
  const admin = supabase.auth?.admin;
  if (!admin) {
    throw new Error('AUTH_ADMIN_UNAVAILABLE');
  }
  return admin;
};

const getOrCreateUserByEmail = async (email: string) => {
  const admin = ensureAuthAdmin();
  const { data: existing, error: existingError } = await admin.getUserByEmail(email);
  if (existingError) {
    throw new Error(existingError.message);
  }
  if (existing?.user) {
    return existing.user;
  }
  const { data: created, error: createError } = await admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    throw new Error(createError?.message || 'Failed to create user');
  }
  return created.user;
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

  const { data: existing } = await supabase
    .from('user_company_roles')
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

  const { data: roles, error } = await supabase
    .from('user_company_roles')
    .select('user_id, company_id, role')
    .eq('company_id', companyId);
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_LIST_USERS' };
  }
  const ids = Array.from(new Set((roles || []).map((row) => row.user_id)));
  const admin = ensureAuthAdmin();
  const users = await Promise.all(
    ids.map(async (userId) => {
      const { data } = await admin.getUserById(userId);
      return { user_id: userId, email: data?.user?.email || null };
    })
  );
  const roleMap = (roles || []).reduce<Record<string, string>>((acc, row) => {
    acc[row.user_id] = row.role;
    return acc;
  }, {});
  return {
    ok: true,
    users: users.map((user) => ({
      user_id: user.user_id,
      email: user.email,
      role: roleMap[user.user_id] || null,
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

  const { data, error } = await supabase
    .from('user_company_roles')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .update({ role: role.toUpperCase() })
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

  const { error } = await supabase
    .from('user_company_roles')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .delete();
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
