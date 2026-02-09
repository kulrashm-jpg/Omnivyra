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

export const ALL_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.CONTENT_CREATOR,
  Role.VIEW_ONLY,
];

export const PERMISSIONS: Record<string, string[]> = {
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

export const normalizePermissionRole = (role: string) => {
  if (role === Role.ADMIN) return Role.COMPANY_ADMIN;
  if (role === Role.CONTENT_MANAGER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_PLANNER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_ENGAGER) return Role.VIEW_ONLY;
  if (role === Role.VIEWER) return Role.VIEW_ONLY;
  return role;
};

export const hasPermission = (role: string | null, action: string): boolean => {
  if (!role) return false;
  const allowed = PERMISSIONS[action] || [];
  if (allowed.includes('*')) return true;
  const normalized = normalizePermissionRole(role);
  return allowed.includes(normalized);
};

const normalizeRole = (value?: string | null): Role | null => {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === 'ADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'CONTENT_MANAGER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_PLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_ENGAGER') return Role.VIEW_ONLY;
  if (upper === 'VIEWER') return Role.VIEW_ONLY;
  return (Role as Record<string, Role>)[upper] || null;
};

export const getUserRole = async (
  userId: string,
  companyId: string
): Promise<{ role: Role | null; error: string | null }> => {
  const { data: anyRoleRows, error: anyRoleError } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', userId);
  if (anyRoleError) {
    return { role: null, error: null };
  }
  if (!anyRoleRows || anyRoleRows.length === 0) {
    return { role: null, error: null };
  }

  const { data, error } = await supabase
    .from('user_company_roles')
    .select('role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1);
  if (error) {
    return { role: null, error: null };
  }
  if (!data || data.length === 0) {
    if (anyRoleRows && anyRoleRows.length > 0) {
      return { role: null, error: 'COMPANY_ACCESS_DENIED' };
    }
    return { role: null, error: null };
  }
  const normalizedRole = normalizeRole(data[0].role);
  if (process.env.NODE_ENV !== 'test') {
    console.log('RBAC_CHECK', {
      userId,
      companyId,
      role: normalizedRole,
      status: data[0].status || null,
    });
  }
  return { role: normalizedRole, error: null };
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

  const superAdmin = await isSuperAdmin(user.userId);
  if (superAdmin && input.allowedRoles.includes(Role.SUPER_ADMIN)) {
    return { userId: user.userId, role: Role.SUPER_ADMIN };
  }

  const { role, error } = await getUserRole(user.userId, companyId);
  if (error === 'COMPANY_ACCESS_DENIED') {
    input.res.status(403).json({ error: 'COMPANY_SCOPE_VIOLATION' });
    return null;
  }
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
