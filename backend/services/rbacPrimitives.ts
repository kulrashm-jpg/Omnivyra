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

/**
 * The caller's role in the company from an ACTIVE membership only (Closure-015E): an invited membership confers no
 * authority before acceptance (team/accept-invite, activate_invitation_membership activates it). null = no active
 * membership or the read failed.
 */
export const getActiveCompanyRole = async (
  userId: string,
  companyId: string
): Promise<Role | null> => {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { role: string };
  return normalizeRole(row.role);
};

/**
 * @deprecated Use getActiveCompanyRole. This name CONTRADICTS the body: it resolves ACTIVE memberships only and
 * never an invited one (Closure-015E). Kept as an alias so the ~25 call sites (imported via rbacService) and the
 * test mocks that name it keep working until the mechanical rename moves them (e9 2026-11-14: alias now; the
 * call-site + mock move follows once rbacService re-exports getActiveCompanyRole).
 */
export const getCompanyRoleIncludingInvited = getActiveCompanyRole;
