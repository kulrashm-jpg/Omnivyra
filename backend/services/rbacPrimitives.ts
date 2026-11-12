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

/**
 * The NON-ADMIN tenant roles a member may be placed in by a non-governed path
 * (self-joined confirmation, ownership-recovery demotion). ONE list (05,
 * 2026-11-12): two hand-kept copies drift and fail differently.
 * OWNER RULING (e9, 2026-11-12): CONTENT_MANAGER, CONTENT_PLANNER,
 * CONTENT_ENGAGER and VIEWER are REAL tenant roles and belong here. FINANCE_*
 * stays OUT. The invitations_role_check widening is a separate migration.
 * KNOWN GAP (blocking release of this unit): normalizeRole still maps the four
 * onto CONTENT_CREATOR / VIEW_ONLY for RBAC, and CapabilityService reads the
 * RAW role, for which ROLE_CAPABILITIES has no entry - so a member stored as
 * one of the four holds NO capability until the per-role sets are ruled.
 */
export const NON_ADMIN_TENANT_ROLES = [
  Role.CONTENT_CREATOR,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.VIEW_ONLY,
  Role.CONTENT_MANAGER,
  Role.CONTENT_PLANNER,
  Role.CONTENT_ENGAGER,
  Role.VIEWER,
] as const;

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
 * Closure-015E — despite its name, this now resolves ACTIVE memberships only.
 * An invited membership confers no authority before acceptance: acceptance
 * (team/accept-invite, activate_invitation_membership) is what activates it.
 * Its ~20 callers use it as a fallback after getUserRole; they included invited
 * COMPANY_ADMIN / ADMIN / SUPER_ADMIN rows and, at several call sites, invited
 * rows of ANY role. The name is kept so those callers are unchanged.
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
    .eq('status', 'active')
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { role: string };
  return normalizeRole(row.role);
};
