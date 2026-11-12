import { supabase } from '../db/supabaseClient';
import {
  NON_ADMIN_TENANT_ROLES as SHARED_NON_ADMIN_TENANT_ROLES,
  INVITABLE_TENANT_ROLES as SHARED_INVITABLE_TENANT_ROLES,
} from '../../shared/rbac/tenantRoles';

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
 * The former KNOWN GAP is CLOSED on this branch: roles Approach A R1 (the four
 * keep their identity, authorised by ROLE_BASE_TIERS below) and R2 (explicit
 * ROLE_CAPABILITIES entries, since CapabilityService reads the RAW role).
 */
export const NON_ADMIN_TENANT_ROLES: ReadonlyArray<Role> = SHARED_NON_ADMIN_TENANT_ROLES; // the SAME object as shared/rbac/tenantRoles

/**
 * The roles an INVITATION may carry = invitations_role_check (widened by
 * 20270217000010): COMPANY_ADMIN plus every non-admin tenant role. ONE list for
 * every invite / reinvite / acceptance path (roles step R3, e9 2026-11-12) - no
 * path keeps its own copy and none SILENTLY downgrades a role. SUPER_ADMIN is
 * never invitable (identity.admin.assign only); ADMIN is a legacy alias only.
 */
export const INVITABLE_TENANT_ROLES: ReadonlyArray<Role> = SHARED_INVITABLE_TENANT_ROLES; // shared/rbac/tenantRoles

/**
 * ROLES APPROACH A (owner ruling via e9, 2026-11-12). CONTENT_MANAGER,
 * CONTENT_PLANNER, CONTENT_ENGAGER and VIEWER are REAL roles: they keep their
 * identity (they are no longer rewritten) and authorise through deliberate
 * BASE TIERS - a role satisfies an allow-list that names it OR any of its tiers.
 *   VIEWER          = VIEW_ONLY
 *   CONTENT_ENGAGER = VIEW_ONLY + engagement (named where engagement is granted)
 *   CONTENT_PLANNER = CONTENT_CREATOR + planning (named on planning routes)
 *   CONTENT_MANAGER = CONTENT_PUBLISHER u CONTENT_REVIEWER, incl. create
 *                     (CONTENT_CREATOR, which a manager held before this change)
 * No tier is an admin role: none of the four reaches team / users / roles /
 * external APIs / billing / org, because no admin role is a tier.
 */
// The model lives in shared/rbac/tenantRoles (pure; the client imports it too).
export { ROLE_BASE_TIERS, roleAndTiers, roleSatisfies } from '../../shared/rbac/tenantRoles';

/** Only the legacy ADMIN alias is rewritten; the four content roles keep their identity. */
export const normalizePermissionRole = (role: string) => {
  if (role === Role.ADMIN) return Role.COMPANY_ADMIN;
  return role;
};

export const normalizeRole = (value?: string | null): Role | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (upper === 'ADMIN' || upper === 'COMPANYADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'COMPANY_ADMIN') return Role.COMPANY_ADMIN;
  // Approach A: the four content roles keep their identity (tiers decide access).
  // 'CONTENTPLANNER' is a historical spelling of CONTENT_PLANNER.
  if (upper === 'CONTENTPLANNER') return Role.CONTENT_PLANNER;
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
