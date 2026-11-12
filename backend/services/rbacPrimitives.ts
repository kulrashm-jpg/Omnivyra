import { supabase } from '../db/supabaseClient';

/**
 * Company-status gate for MEMBERSHIP-based authorization (e1, 2026-11-12, BLOCKING safety; e9 ruling).
 *
 * getUserRole / getCompanyRoleIncludingInvited used to check only the MEMBERSHIP row's status, never the company's,
 * so every route authorizing through them (99 route/handler files measured, 62 write-capable) let members of an
 * INACTIVE or SUSPENDED company keep acting - defeating company deactivation. TenantGuard already denies
 * ORG_INACTIVE; this brings the membership helpers to the same rule.
 *
 * companies.status values (companies_status_check): 'active' | 'inactive' | 'suspended'; the column is nullable.
 *   active (and deleted_at IS NULL)  -> roles resolve as before
 *   inactive / suspended / NULL / soft-deleted / row missing -> NO ROLE ('COMPANY_INACTIVE')
 *   status read error                -> NO ROLE ('COMPANY_STATUS_UNAVAILABLE') - fail closed, never "active"
 * There is no self-serve "pay to reactivate" path: no code sets companies.status from billing (non-payment blocks
 * are org financial controls, a separate mechanism), and reactivation is super-admin only
 * (pages/api/super-admin/companies.ts, requireSuperAdminUser - not a membership role). So nothing a company member
 * needs stays reachable on an inactive company.
 *
 * EXEMPTIONS (resolved by the callers BEFORE they consult a membership role, and unchanged here):
 *   - platform SUPER_ADMIN administration (isPlatformSuperAdmin / isSuperAdmin / requireSuperAdminUser /
 *     the legacy super-admin session);
 *   - the content_architect platform principal (enforceRole / getUserCompanyRole / enforceCompanyAccess).
 */
export type CompanyRoleGate = 'active' | 'inactive' | 'unavailable';
type TableFactory = (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const companyRoleGate = async (
  companyId: string,
  from: TableFactory = (t) => supabase.from(t),
): Promise<CompanyRoleGate> => {
  const { data, error } = await from('companies')
    .select('status, deleted_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) return 'unavailable';
  const row = data as { status?: string | null; deleted_at?: string | null } | null;
  if (!row || row.status !== 'active' || row.deleted_at) return 'inactive';
  return 'active';
};

/**
 * The subset of `companyIds` whose company is active and not soft-deleted (same rule as companyRoleGate).
 * Returns null when the status read fails - callers treat that as "no operational company" (fail closed).
 */
export const operationalCompanyIds = async (
  companyIds: Array<string | null | undefined>,
  from: TableFactory = (t) => supabase.from(t),
): Promise<Set<string> | null> => {
  const ids = Array.from(new Set(companyIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return new Set();
  const { data, error } = await from('companies').select('id, status, deleted_at').in('id', ids);
  if (error) return null;
  return new Set(
    ((data ?? []) as Array<{ id: string; status?: string | null; deleted_at?: string | null }>)
      .filter((r) => r.status === 'active' && !r.deleted_at)
      .map((r) => String(r.id)),
  );
};

/**
 * For routes that DERIVE the caller's company from their memberships: an operational company, chosen
 * DETERMINISTICALLY (e9 2026-11-13) - the user's stored users.active_company_id when it is among the operational
 * candidates, otherwise the lowest company_id. null when none is operational or the company status read failed
 * (fail closed). A user in two companies keeps an active one; a membership in an inactive company is never picked.
 * (Tier 3 replaces these derive-my-company sites with the principal's context.)
 */
export const pickOperationalMembership = async <T extends { company_id?: string | null }>(
  rows: T[] | null | undefined,
  opts: { userId?: string | null; from?: TableFactory } = {},
): Promise<T | null> => {
  const from = opts.from ?? ((t: string) => supabase.from(t));
  const list = rows ?? [];
  const ok = await operationalCompanyIds(list.map((r) => r.company_id), from);
  if (!ok) return null;
  const candidates = list
    .filter((r) => !!r.company_id && ok.has(String(r.company_id)))
    .sort((a, b) => String(a.company_id).localeCompare(String(b.company_id)));
  if (candidates.length <= 1 || !opts.userId) return candidates[0] ?? null;
  // Preference only - a failed read keeps the deterministic default, never widens the candidate set.
  const { data, error } = await from('users').select('active_company_id').eq('id', opts.userId).maybeSingle();
  const preferred = !error ? (data as { active_company_id?: string | null } | null)?.active_company_id : null;
  return candidates.find((r) => preferred && String(r.company_id) === String(preferred)) ?? candidates[0];
};

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
  // A membership in an inactive / suspended / deleted company confers no role; a status read error neither.
  if ((await companyRoleGate(companyId)) !== 'active') return null;
  const row = data[0] as { role: string };
  return normalizeRole(row.role);
};
