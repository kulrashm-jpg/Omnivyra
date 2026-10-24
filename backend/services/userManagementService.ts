import { supabase } from '../db/supabaseClient';
import type { UserContext } from './userContextService';
import { getUserRole, isSuperAdmin, Role } from './rbacService';
import { normalizeRole } from './rbacPrimitives';
import { logUserManagementAudit } from './campaignAuditService';
import { ensureUnifiedPerson } from '../../lib/identity/identityGateway';
import { ownedDbTable } from '../db/writeOwner';

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
const getOrCreateUserByEmail = async (email: string, companyId?: string): Promise<AuthUser> => {
  const normalizedEmail = email.toLowerCase().trim();

  // Look up existing user row by email (DB is the authoritative identity store)
  const { data: existing } = await ownedDbTable('users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) return { id: (existing as any).id, email: (existing as any).email };

  const unifiedPersonId = await ensureUnifiedPerson({
    email: normalizedEmail,
    phone: null,
    companyId,
  });

  // Create a stub row — supabase_uid is populated on first sign-in via sync-supabase-user.
  const { data: created, error: createError } = await ownedDbTable('users')
    .insert({
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0] || 'User',
      created_at: new Date().toISOString(),
      unified_person_id: unifiedPersonId,
    })
    .select('id, email')
    .single();

  if (createError || !created) {
    // Handle race condition
    if (createError?.code === '23505') {
      const { data: retry } = await ownedDbTable('users').select('id, email').eq('email', normalizedEmail).maybeSingle();
      if (retry) return { id: (retry as any).id, email: (retry as any).email };
    }
    throw new Error(createError?.message || 'Failed to create user');
  }
  return { id: (created as any).id, email: (created as any).email };
};

/**
 * Closure-015D — the role names this ordinary invitation writer accepts: exactly
 * the server's Role vocabulary (rbacPrimitives.Role — the canonical names plus
 * the legacy names the /admin/users page sends, each of which normalizeRole maps
 * deterministically), compared case-insensitively, minus SUPER_ADMIN (granted
 * only through identity.admin.assign). Anything else — an unknown name, or an
 * alias spelling normalizeRole would also tolerate (e.g. 'COMPANYADMIN',
 * 'content creator') — fails closed instead of being stored verbatim.
 */
export const INVITABLE_ROLES: ReadonlyArray<Role> = Object.values(Role).filter((r) => r !== Role.SUPER_ADMIN);

export const inviteUser = async (
  email: string,
  companyId: string,
  role: string,
  requester: UserContext
) => {
  const access = await requireUserAdminAccess(requester, companyId);
  if (!access.ok) return access;

  // Closure-015C (P3) — a SUPER_ADMIN membership is granted only through
  // identity.admin.assign and revoked only through identity.admin.revoke (the
  // governed, step-up paths: admin/invite-user, admin/revoke-super-admin). This
  // writer may do neither: it refuses SUPER_ADMIN as the requested role (before
  // any user row is created) and refuses to rewrite an existing SUPER_ADMIN
  // membership. Every other role, incl. the legacy names the /admin/users page
  // sends, is unchanged.
  if (normalizeRole(role) === Role.SUPER_ADMIN) {
    return { ok: false as const, status: 403, error: 'SUPER_ADMIN_NOT_ASSIGNABLE_HERE' };
  }

  const normalizedRole = role.toUpperCase();
  if (!(INVITABLE_ROLES as ReadonlyArray<string>).includes(normalizedRole)) {
    return { ok: false as const, status: 400, error: 'UNSUPPORTED_ROLE', allowedRoles: INVITABLE_ROLES };
  }

  const user = await getOrCreateUserByEmail(email, companyId);

  const { data: existing } = await (ownedDbTable('user_company_roles') as any)
    .select('id, role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .limit(1);

  if (existing && existing.length > 0) {
    const existingRow = existing[0];
    if (normalizeRole(existingRow.role) === Role.SUPER_ADMIN) {
      return { ok: false as const, status: 403, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' };
    }
    if (existingRow.role !== normalizedRole) {
      await ownedDbTable('user_company_roles')
        .update({ role: normalizedRole })
        .eq('id', existingRow.id);
    }
  } else {
    await ownedDbTable('user_company_roles').insert({
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

  const { data: roles, error } = await (ownedDbTable('user_company_roles') as any)
    .select('user_id, company_id, role')
    .eq('company_id', companyId);
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_LIST_USERS' };
  }
  const ids = Array.from(new Set((roles || []).map((row: { user_id: string }) => row.user_id)));
  const emailById: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: usersData } = await ownedDbTable('users')
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

  // Closure-015E — the same role governance as inviteUser. SUPER_ADMIN is granted
  // only through identity.admin.assign and revoked only through
  // identity.admin.revoke, so this writer neither sets it nor changes a
  // membership that holds it (any status). Other roles: exactly INVITABLE_ROLES.
  // Only an ACTIVE membership changes role (as companies/promote-admin): an
  // invited one activates invitation.role on acceptance, an inactive or expired
  // one is not a member. Every refusal happens before any write.
  const requestedRole = role.toUpperCase();
  if (normalizeRole(role) === Role.SUPER_ADMIN) {
    return { ok: false as const, status: 403, error: 'SUPER_ADMIN_NOT_ASSIGNABLE_HERE' };
  }
  if (!(INVITABLE_ROLES as ReadonlyArray<string>).includes(requestedRole)) {
    return { ok: false as const, status: 400, error: 'UNSUPPORTED_ROLE', allowedRoles: INVITABLE_ROLES };
  }

  const { data: current, error: readError } = await (ownedDbTable('user_company_roles') as any)
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);
  if (readError) {
    return { ok: false as const, status: 503, error: 'MEMBERSHIP_LOOKUP_FAILED' };
  }
  const row = (current ?? [])[0] as { id: string; role: string; status: string | null } | undefined;
  if (!row) {
    return { ok: false as const, status: 404, error: 'USER_ROLE_NOT_FOUND' };
  }
  if (normalizeRole(row.role) === Role.SUPER_ADMIN) {
    return { ok: false as const, status: 403, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' };
  }
  if (row.status !== 'active') {
    return { ok: false as const, status: 409, error: 'STALE_MEMBERSHIP' };
  }

  // Compare-and-set on the row read above: still active, still the same role.
  // (Closure-015F: the compared values are snapshotted at read time.)
  const readId = row.id;
  const readRole = row.role;
  const { data, error } = await (ownedDbTable('user_company_roles') as any)
    .update({ role: requestedRole })
    .eq('id', readId)
    .eq('status', 'active')
    .eq('role', readRole)
    .select('id')
    .limit(1);
  if (error) {
    return { ok: false as const, status: 503, error: 'MEMBERSHIP_UPDATE_FAILED' };
  }
  if (!data || data.length === 0) {
    return { ok: false as const, status: 409, error: 'STALE_MEMBERSHIP' };
  }

  logUserManagementAudit('USER_ROLE_UPDATED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: companyId,
    role: requestedRole,
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

  // Closure-015F — "remove user" deletes this user's membership in THIS company
  // only (the user record and other companies' memberships are untouched). A
  // SUPER_ADMIN membership (any status) is refused: revocation is governed by
  // identity.admin.revoke (admin/revoke-super-admin, which downgrades rather than
  // deletes), and what deleting a privileged membership should mean is an owner
  // decision, so it fails closed. The delete is conditional on the row read (id
  // and role), so a concurrent promotion to SUPER_ADMIN is never deleted.
  const { data: current, error: readError } = await (ownedDbTable('user_company_roles') as any)
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);
  if (readError) {
    return { ok: false as const, status: 503, error: 'MEMBERSHIP_LOOKUP_FAILED' };
  }
  const row = (current ?? [])[0] as { id: string; role: string } | undefined;
  if (!row) {
    return { ok: false as const, status: 404, error: 'USER_ROLE_NOT_FOUND' };
  }
  // Snapshot what the conditional delete compares against, at read time.
  const readId = row.id;
  const readRole = row.role;
  if (normalizeRole(readRole) === Role.SUPER_ADMIN) {
    return { ok: false as const, status: 403, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_REMOVABLE_HERE' };
  }

  const { data: deleted, error } = await (ownedDbTable('user_company_roles') as any)
    .delete()
    .eq('id', readId)
    .eq('role', readRole)
    .select('id');
  if (error) {
    return { ok: false, status: 500, error: 'FAILED_TO_REMOVE_USER' };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false as const, status: 409, error: 'STALE_MEMBERSHIP' };
  }

  logUserManagementAudit('USER_REMOVED', {
    actor_user_id: requester.userId,
    target_user_id: userId,
    company_id: companyId,
    role: null,
  });

  return { ok: true };
};
