import { supabase } from '../db/supabaseClient';
import { resolveUserContext } from './userContextService';
import type { NextApiRequest, NextApiResponse } from 'next';

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  CONTENT_MANAGER: 'CONTENT_MANAGER',
  CONTENT_REVIEWER: 'CONTENT_REVIEWER',
  CONTENT_PUBLISHER: 'CONTENT_PUBLISHER',
  CONTENT_PLANNER: 'CONTENT_PLANNER',
  CONTENT_CREATOR: 'CONTENT_CREATOR',
  CONTENT_ENGAGER: 'CONTENT_ENGAGER',
  VIEWER: 'VIEWER',
  VIEW_ONLY: 'VIEW_ONLY',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

type RbacPermissions = Record<string, string[]>;
type RbacConfig = {
  roles: Role[];
  permissions: RbacPermissions;
};

export const ALL_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.CONTENT_CREATOR,
  Role.VIEW_ONLY,
];

export const PERMISSIONS: RbacPermissions = {
  VIEW_DASHBOARD: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.VIEW_ONLY,
    Role.SUPER_ADMIN,
  ],
  VIEW_TEAM: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_ANALYTICS: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.VIEW_ONLY,
    Role.SUPER_ADMIN,
  ],
  CREATE_USER: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  ASSIGN_ROLE: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  APPROVE_CONTENT: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  PUBLISH_CONTENT: [Role.CONTENT_PUBLISHER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  CREATE_CAMPAIGN: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.SUPER_ADMIN,
  ],
  VIEW_CAMPAIGNS: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.SUPER_ADMIN,
  ],
  MANAGE_EXTERNAL_APIS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_CONTENT: ['*'],
};

const RBAC_CACHE_TTL_MS = 30000;
let rbacCache: { value: RbacConfig; fetchedAt: number } | null = null;

const normalizePermissionKey = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, '_');

const normalizeRoles = (roles: unknown): Role[] => {
  if (!Array.isArray(roles)) return ALL_ROLES;
  const normalized = Array.from(
    new Set(
      roles
        .map((role) => String(role || '').trim().toUpperCase())
        .filter((role) => (ALL_ROLES as string[]).includes(role))
    )
  ) as Role[];
  if (!normalized.includes(Role.SUPER_ADMIN)) {
    normalized.unshift(Role.SUPER_ADMIN);
  }
  return normalized.length ? normalized : ALL_ROLES;
};

const normalizePermissions = (permissions: unknown, roles: Role[]): RbacPermissions => {
  if (!permissions || typeof permissions !== 'object') return { ...PERMISSIONS };
  const allowedRoles = new Set(roles);
  const entries = Object.entries(permissions as Record<string, unknown>);
  const normalized = entries.reduce<RbacPermissions>((acc, [key, value]) => {
    const permissionKey = normalizePermissionKey(key);
    if (!permissionKey) return acc;
    const rawList = Array.isArray(value) ? value : value ? [value] : [];
    const cleaned = Array.from(
      new Set(
        rawList
          .map((item) => String(item || '').trim().toUpperCase())
          .filter((role) => role === '*' || allowedRoles.has(role as Role))
      )
    );
    acc[permissionKey] = cleaned;
    return acc;
  }, {});
  return Object.keys(normalized).length ? normalized : { ...PERMISSIONS };
};

export const clearRbacCache = () => {
  rbacCache = null;
};

export const getRbacConfig = async (): Promise<RbacConfig> => {
  const now = Date.now();
  if (rbacCache && now - rbacCache.fetchedAt < RBAC_CACHE_TTL_MS) {
    return rbacCache.value;
  }
  const fallback: RbacConfig = { roles: ALL_ROLES, permissions: { ...PERMISSIONS } };
  const { data, error } = await supabase
    .from('rbac_config')
    .select('roles, permissions, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) {
    rbacCache = { value: fallback, fetchedAt: now };
    return fallback;
  }
  const row = (data[0] || {}) as { roles?: unknown; permissions?: unknown };
  const roles = normalizeRoles(row.roles);
  const permissions = normalizePermissions(row.permissions, roles);
  const value = { roles, permissions };
  rbacCache = { value, fetchedAt: now };
  return value;
};

export const saveRbacConfig = async (input: {
  roles: Role[];
  permissions: RbacPermissions;
  updatedBy?: string | null;
}): Promise<RbacConfig> => {
  const roles = normalizeRoles(input.roles);
  const permissions = normalizePermissions(input.permissions, roles);
  const payload = {
    roles,
    permissions,
    updated_by: input.updatedBy || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('rbac_config')
    .insert(payload)
    .select('roles, permissions')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  clearRbacCache();
  const storedRoles = normalizeRoles(data?.roles);
  const storedPermissions = normalizePermissions(data?.permissions, storedRoles);
  return { roles: storedRoles, permissions: storedPermissions };
};

export const normalizePermissionRole = (role: string) => {
  if (role === Role.ADMIN) return Role.COMPANY_ADMIN;
  if (role === Role.CONTENT_MANAGER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_PLANNER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_ENGAGER) return Role.VIEW_ONLY;
  if (role === Role.VIEWER) return Role.VIEW_ONLY;
  return role;
};

export const hasPermission = async (role: string | null, action: string): Promise<boolean> => {
  if (!role) return false;
  const { permissions } = await getRbacConfig();
  const allowed = permissions[action] || [];
  if (allowed.includes('*')) return true;
  const normalized = normalizePermissionRole(role);
  return allowed.includes(normalized);
};

const normalizeRole = (value?: string | null): Role | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (upper === 'ADMIN' || upper === 'COMPANYADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'COMPANY_ADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'CONTENT_MANAGER' || upper === 'CONTENTPLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_PLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_CREATOR') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_ENGAGER') return Role.VIEW_ONLY;
  if (upper === 'VIEWER') return Role.VIEW_ONLY;
  return (Role as Record<string, Role>)[upper] || null;
};

export const getUserRole = async (
  userId: string,
  companyId: string
): Promise<{ role: Role | null; error: string | null; membershipType?: 'EXTERNAL' | 'INTERNAL' }> => {
  // Query company-specific role first (happy path: 1 DB round-trip)
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('role, status, membership_type')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1);
  if (error) {
    return { role: null, error: null, membershipType: undefined };
  }
  if (data && data.length > 0) {
    const row = data[0] as { role: string; status?: string; membership_type?: string | null };
    const rawRole = typeof row.role === 'string' ? row.role.trim() : '';
    const normalizedRole = normalizeRole(rawRole || row.role);
    const membershipType =
      (row.membership_type || '').trim().toUpperCase() === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
    return { role: normalizedRole, error: null, membershipType };
  }

  // No active role: check invited (admin fallback) before "any role" check
  const { data: invitedData } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'invited')
    .limit(1);
  if (invitedData && invitedData.length > 0) {
    const fallbackRole = normalizeRole((invitedData[0] as { role: string }).role);
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      return { role: fallbackRole, error: null, membershipType: 'INTERNAL' };
    }
  }

  // No role for company: check if user has any role (distinguish COMPANY_ACCESS_DENIED vs null)
  const { data: anyRoleRows, error: anyRoleError } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', userId)
    .limit(1);
  if (anyRoleError) return { role: null, error: null, membershipType: undefined };
  if (anyRoleRows && anyRoleRows.length > 0) {
    return { role: null, error: 'COMPANY_ACCESS_DENIED', membershipType: undefined };
  }
  return { role: null, error: null, membershipType: undefined };
};

/**
 * Returns role for (userId, companyId) including rows with status 'invited'.
 * Used so company admins can access company profile even before "accepting" the invite.
 */
export const getCompanyRoleIncludingInvited = async (
  userId: string,
  companyId: string
): Promise<Role | null> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .in('status', ['active', 'invited'])
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { role: string };
  return normalizeRole(row.role);
};

export const getUserCompanyRole = async (
  req: NextApiRequest,
  companyId: string
): Promise<{ role: Role | null; userId: string | null }> => {
  const user = await resolveUserContext(req);
  if (!user?.userId) {
    return { role: null, userId: null };
  }
  if (!companyId) {
    return { role: null, userId: user.userId };
  }
  if (user.userId === 'content_architect') {
    return { role: Role.COMPANY_ADMIN, userId: user.userId };
  }
  const superAdmin = await isSuperAdmin(user.userId);
  if (superAdmin) {
    return { role: Role.SUPER_ADMIN, userId: user.userId };
  }
  const { role } = await getUserRole(user.userId, companyId);
  return { role, userId: user.userId };
};

export const isSuperAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', Role.SUPER_ADMIN)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
};

export const isPlatformSuperAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', Role.SUPER_ADMIN)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
};

export const enforceRole = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  allowedRoles: Role[];
}): Promise<{ userId: string; role: Role } | null> => {
  const hasLegacySuperAdmin = input.req.cookies?.super_admin_session === '1';
  if (hasLegacySuperAdmin && input.allowedRoles.includes(Role.SUPER_ADMIN)) {
    return { userId: 'super_admin_session', role: Role.SUPER_ADMIN };
  }
  const user = await resolveUserContext(input.req);
  const companyId = input.companyId;
  if (!companyId) {
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }
  // Content Architect: platform role with access to all companies (like Super Admin)
  if (user.userId === 'content_architect' && input.allowedRoles.includes(Role.COMPANY_ADMIN)) {
    return { userId: 'content_architect', role: Role.COMPANY_ADMIN };
  }

  // Run role checks in parallel to reduce latency
  const [superAdminResult, platformSuperAdminResult, userRoleResult] = await Promise.all([
    isSuperAdmin(user.userId),
    isPlatformSuperAdmin(user.userId),
    getUserRole(user.userId, companyId),
  ]);
  // Super admins (both isSuperAdmin and isPlatformSuperAdmin) bypass all role restrictions.
  // They are Omnivyra platform admins who control the whole app — they must be able to
  // call any route regardless of which roles that route explicitly lists.
  if (superAdminResult || platformSuperAdminResult) {
    return { userId: user.userId, role: Role.SUPER_ADMIN };
  }

  const { role, error } = userRoleResult;
  if (error === 'COMPANY_ACCESS_DENIED') {
    input.res.status(403).json({ error: 'COMPANY_SCOPE_VIOLATION' });
    return null;
  }
  // getUserRole now includes invited admin fallback internally; no extra getCompanyRoleIncludingInvited call
  if (error || !role) {
    input.res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!input.allowedRoles.includes(role)) {
    input.res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.userId, role };
};
