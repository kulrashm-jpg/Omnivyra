import * as supabaseClient from '../db/supabaseClient';
import type { UserContext } from './userContextService';
import { getUserRole, isPlatformSuperAdmin, Role } from './rbacService';
import { logUserManagementAudit } from './campaignAuditService';
import { createOrExtendInvite } from '../../lib/inviteService';
import { UserState, assertValidTransition, normalizeUserState } from '../../lib/userLifecycle';

type AccessResult =
  | { ok: true; scope: 'super_admin' | 'admin' }
  | { ok: false; status: number; error: string };

const runWithServiceRole = async <T>(
  reason: string,
  fn: (client: any) => PromiseLike<T> | T,
): Promise<T> => {
  const runner = (supabaseClient as any).runWithServiceRole;
  if (typeof runner === 'function') {
    return runner(reason, fn);
  }
  const mockClient = (supabaseClient as any).supabase;
  if (mockClient) {
    return await fn(mockClient);
  }
  throw new Error('runWithServiceRole export is missing');
};

const requireUserAdminAccess = async (
  requester: UserContext,
  organization_id: string
): Promise<AccessResult> => {
  const superAdmin = await isPlatformSuperAdmin(requester.userId);
  if (superAdmin) {
    return { ok: true, scope: 'super_admin' };
  }
  const { role, error } = await getUserRole(requester.userId, organization_id);
  if (error === 'COMPANY_ACCESS_DENIED') {
    return { ok: false, status: 403, error: 'COMPANY_SCOPE_VIOLATION' };
  }
  if (!role) {
    return { ok: false, status: 403, error: 'ROLE_NOT_ASSIGNED' };
  }
  if (role !== Role.ADMIN && role !== Role.COMPANY_ADMIN) {
    return { ok: false, status: 403, error: 'NOT_AUTHORIZED' };
  }
  return { ok: true, scope: 'admin' };
};

type AuthUser = { id: string; email?: string; state?: UserState };

const getOrCreateUserByEmail = async (
  email: string,
  organization_id: string,
): Promise<AuthUser> => {
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await runWithServiceRole(
    'Look up user by invite email',
    (client) => client
      .from('users')
      .select('id, email, state')
      .eq('email', normalizedEmail)
      .maybeSingle(),
  );

  if (existing) {
    return {
      id: String((existing as any).id),
      email: String((existing as any).email),
      state: normalizeUserState((existing as any).state ?? UserState.INVITED),
    };
  }

  const { data: created, error: createError } = await runWithServiceRole(
    'Create invited user stub',
    (client) => client
      .from('users')
      .insert({
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0] || 'User',
        state: UserState.INVITED,
        organization_id,
        created_at: new Date().toISOString(),
      })
      .select('id, email, state')
      .single(),
  );

  if (createError || !created) {
    if ((createError as any)?.code === '23505') {
      const { data: retry } = await runWithServiceRole(
        'Retry invited user lookup after race',
        (client) => client
          .from('users')
          .select('id, email, state')
          .eq('email', normalizedEmail)
          .maybeSingle(),
      );
      if (retry) {
        return {
          id: String((retry as any).id),
          email: String((retry as any).email),
          state: normalizeUserState((retry as any).state ?? UserState.INVITED),
        };
      }
    }
    throw new Error((createError as any)?.message || 'Failed to create user');
  }

  return {
    id: String((created as any).id),
    email: String((created as any).email),
    state: normalizeUserState((created as any).state ?? UserState.INVITED),
  };
};

const activeRoleStatuses = ['invited', 'pending', 'active'];

export const inviteUser = async (
  email: string,
  organization_id: string,
  role: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, organization_id);
  if (!access.ok) return access;

  const user = await getOrCreateUserByEmail(email, organization_id);
  if (user.state && ![UserState.INVITED, UserState.PENDING].includes(user.state)) {
    return { ok: false, status: 409, error: 'USER_NOT_INVITABLE_IN_CURRENT_STATE' };
  }

  const normalizedRole = role.toUpperCase();
  const invite = await createOrExtendInvite({
    email,
    organization_id,
    role: normalizedRole,
    invited_by: requester.userId,
  });
  if (!invite.ok) return invite;

  const { data: existing } = await runWithServiceRole(
    'Resolve user organization membership before invite',
    (client) => client
      .from('user_company_roles')
      .select('id, role, status')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .in('status', activeRoleStatuses)
      .limit(1),
  );

  const now = new Date().toISOString();
  if (existing && existing.length > 0) {
    const existingRow = existing[0];
    await runWithServiceRole(
      'Update invited user organization role',
      (client) => client
        .from('user_company_roles')
        .update({ role: normalizedRole, status: 'invited', updated_at: now })
        .eq('id', existingRow.id),
    );
  } else {
    await runWithServiceRole(
      'Create invited user organization role',
      (client) => client.from('user_company_roles').insert({
        user_id: user.id,
        company_id: organization_id,
        organization_id,
        role: normalizedRole,
        status: 'invited',
        invited_at: now,
        created_at: now,
      }),
    );
  }

  await runWithServiceRole(
    'Set invited user canonical organization',
    (client) => client
      .from('users')
      .update({ organization_id, state: UserState.INVITED, updated_at: now })
      .eq('id', user.id)
      .in('state', [UserState.INVITED, UserState.PENDING]),
  );

  logUserManagementAudit('USER_INVITED', {
    actor_user_id: requester.userId,
    target_user_id: user.id,
    company_id: organization_id,
    organization_id,
    role: normalizedRole,
  });

  return {
    ok: true,
    user_id: user.id,
    email: user.email,
    role: normalizedRole,
    invite: invite.invite,
    reused: invite.reused,
  };
};

export const listUsers = async (organization_id: string, requester: UserContext) => {
  const access = await requireUserAdminAccess(requester, organization_id);
  if (!access.ok) return access;

  const { data: roles, error } = await runWithServiceRole(
    'List organization users',
    (client) => client
      .from('user_company_roles')
      .select('user_id, organization_id, role, status')
      .eq('organization_id', organization_id),
  );
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_LIST_USERS' };
  }

  const ids = Array.from(new Set((roles || []).map((row: { user_id: string }) => row.user_id)));
  const usersById: Record<string, { email: string | null; state: string | null }> = {};
  if (ids.length > 0) {
    const { data: usersData } = await runWithServiceRole(
      'List organization user identities',
      (client) => client
        .from('users')
        .select('id, email, state')
        .in('id', ids),
    );
    (usersData || []).forEach((u: any) => {
      if (u.id) usersById[u.id] = { email: u.email ?? null, state: u.state ?? null };
    });
  }

  return {
    ok: true,
    users: (roles || []).map((row: { user_id: string; role: string; status: string }) => ({
      user_id: row.user_id,
      email: usersById[row.user_id]?.email ?? null,
      role: row.role,
      status: row.status,
      state: usersById[row.user_id]?.state ?? null,
    })),
  };
};

export const updateUserRole = async (
  userId: string,
  organization_id: string,
  role: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, organization_id);
  if (!access.ok) return access;

  const { data, error } = await runWithServiceRole(
    'Update organization user role',
    (client) => client
      .from('user_company_roles')
      .update({ role: role.toUpperCase(), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('organization_id', organization_id)
      .select('*')
      .limit(1),
  );
  if (error || !data || data.length === 0) {
    return { ok: false, status: 404, error: 'USER_ROLE_NOT_FOUND' };
  }

  logUserManagementAudit('USER_ROLE_UPDATED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: organization_id,
    organization_id,
    role: role.toUpperCase(),
  });

  return { ok: true };
};

export const removeUser = async (
  userId: string,
  organization_id: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, organization_id);
  if (!access.ok) return access;

  const { data: userRow } = await runWithServiceRole(
    'Resolve user lifecycle state before delete',
    (client) => client.from('users').select('state').eq('id', userId).maybeSingle(),
  );
  const currentState = normalizeUserState((userRow as any)?.state ?? UserState.ACTIVE);
  assertValidTransition(currentState, UserState.DELETED);

  const now = new Date().toISOString();
  const { error } = await runWithServiceRole(
    'Soft delete organization user membership',
    (client) => client
      .from('user_company_roles')
      .update({ status: 'inactive', deactivated_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('organization_id', organization_id),
  );
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_REMOVE_USER' };
  }

  await runWithServiceRole(
    'Mark user deleted',
    (client) => client
      .from('users')
      .update({ state: UserState.DELETED, is_deleted: true, deleted_at: now, updated_at: now })
      .eq('id', userId),
  );

  logUserManagementAudit('USER_REMOVED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: organization_id,
    organization_id,
    role: null,
  });

  return { ok: true };
};

export const restoreUser = async (
  userId: string,
  organization_id: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, organization_id);
  if (!access.ok) return access;

  const { data: userRow } = await runWithServiceRole(
    'Resolve user lifecycle state before restore',
    (client) => client.from('users').select('state').eq('id', userId).maybeSingle(),
  );
  const currentState = normalizeUserState((userRow as any)?.state ?? UserState.DELETED);
  if (currentState !== UserState.DELETED) {
    return { ok: false, status: 409, error: 'ONLY_DELETED_USERS_CAN_BE_RESTORED' };
  }
  assertValidTransition(currentState, UserState.ACTIVE);

  const now = new Date().toISOString();
  await runWithServiceRole(
    'Restore organization user membership',
    (client) => client
      .from('user_company_roles')
      .update({ status: 'active', deactivated_at: null, updated_at: now })
      .eq('user_id', userId)
      .eq('organization_id', organization_id),
  );
  await runWithServiceRole(
    'Restore user lifecycle state',
    (client) => client
      .from('users')
      .update({
        state: UserState.ACTIVE,
        is_deleted: false,
        deleted_at: null,
        restored_from_state: currentState,
        restored_at: now,
        restored_by: requester.userId,
        updated_at: now,
      })
      .eq('id', userId),
  );

  logUserManagementAudit('USER_RESTORED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: organization_id,
    organization_id,
    role: null,
  });

  return { ok: true };
};
