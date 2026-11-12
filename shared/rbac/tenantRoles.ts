/**
 * Tenant role model - PURE (no I/O), imported by BOTH the server
 * (backend/services/rbacPrimitives re-exports these exact objects) and the
 * client (components/CompanyContext, pages/admin/users). ONE source, so the UI
 * and the API can never disagree about what a role may do.
 *
 * ROLES APPROACH A (owner ruling via e9, 2026-11-12): CONTENT_MANAGER,
 * CONTENT_PLANNER, CONTENT_ENGAGER and VIEWER are REAL roles. They keep their
 * identity and authorise through deliberate BASE TIERS - a role satisfies an
 * allow-list that names it OR any of its tiers.
 *   VIEWER          = VIEW_ONLY
 *   CONTENT_ENGAGER = VIEW_ONLY + engagement (named where engagement is granted)
 *   CONTENT_PLANNER = CONTENT_CREATOR + planning (named on planning routes)
 *   CONTENT_MANAGER = CONTENT_PUBLISHER u CONTENT_REVIEWER, incl. create
 *                     (CONTENT_CREATOR, which a manager held before this change)
 * No tier is an admin role: none of the four reaches team / users / roles /
 * external APIs / billing / org.
 */

/**
 * The NON-ADMIN tenant roles (self-joined confirmation, ownership-recovery
 * demotion, invitations). ONE list (05, 2026-11-12). FINANCE_* stays OUT.
 */
export const NON_ADMIN_TENANT_ROLES = [
  'CONTENT_CREATOR',
  'CONTENT_REVIEWER',
  'CONTENT_PUBLISHER',
  'VIEW_ONLY',
  'CONTENT_MANAGER',
  'CONTENT_PLANNER',
  'CONTENT_ENGAGER',
  'VIEWER',
] as const;

/** The roles an invitation may carry = invitations_role_check (20270217000010). */
export const INVITABLE_TENANT_ROLES = ['COMPANY_ADMIN', ...NON_ADMIN_TENANT_ROLES] as const;

export const ROLE_BASE_TIERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  VIEWER: ['VIEW_ONLY'],
  CONTENT_ENGAGER: ['VIEW_ONLY'],
  CONTENT_PLANNER: ['CONTENT_CREATOR'],
  CONTENT_MANAGER: ['CONTENT_CREATOR', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER'],
};

/** The role itself plus its base tiers (the set an allow-list is matched against). */
export const roleAndTiers = (role: string | null | undefined): string[] =>
  role ? [role, ...(ROLE_BASE_TIERS[role] ?? [])] : [];

/** True when `allowed` names the role or one of its base tiers ('*' allows any role). */
export const roleSatisfies = (role: string | null | undefined, allowed: ReadonlyArray<string>): boolean =>
  !!role && (allowed.includes('*') || roleAndTiers(role).some((r) => allowed.includes(r)));
