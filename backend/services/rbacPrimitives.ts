import { supabase } from '../db/supabaseClient';

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

export const normalizePermissionRole = (role: string) => {
  if (role === Role.ADMIN) return Role.COMPANY_ADMIN;
  if (role === Role.CONTENT_MANAGER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_PLANNER) return Role.CONTENT_CREATOR;
  if (role === Role.CONTENT_ENGAGER) return Role.VIEW_ONLY;
  if (role === Role.VIEWER) return Role.VIEW_ONLY;
  return role;
};

export const normalizeRole = (value?: string | null): Role | null => {
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
