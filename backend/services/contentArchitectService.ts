import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getUserRole, isSuperAdmin } from './rbacService';
import { getCompanyRoleIncludingInvited, Role } from './rbacPrimitives';

/**
 * Company access resolution for API routes.
 *
 * The module keeps its historical name because ~150 routes import
 * `resolveCompanyAccess` from it. The legacy "Content Architect" privilege
 * path that used to live here — the shared env-credential login, the signed
 * Content Architect bridge cookie, and the synthetic principal it minted,
 * which was treated as an admin of EVERY company — was REMOVED pre-launch
 * (owner ruling 2026-11-13). A future Content Architect feature will be built
 * on real, named accounts and the CONTENT_ARCHITECT_* capabilities; nothing in
 * this module grants access without an authenticated identity.
 */

/**
 * Resolve company access for any request: an authenticated Supabase user with
 * a role for the requested company (or an active platform super admin).
 * Sends 400/401/403 and returns null on failure; returns { userId, role } on success.
 *
 * Isolation: COMPANY_ADMIN only gets access when getUserRole(userId, companyId) returns a role
 * for that exact company — so a company's admin can only view their own company, never another.
 */
export async function resolveCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string | null
): Promise<{ userId: string; role: string } | null> {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  // Company Admin and other roles: access only for the specific company they have a role for
  let role: string | null = null;
  let roleError: string | null = null;
  const roleResult = await getUserRole(user.id, companyId);
  role = roleResult.role;
  roleError = roleResult.error;
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallbackRole = await getCompanyRoleIncludingInvited(user.id, companyId);
    // Closure-015D removed SUPER_ADMIN here; Closure-015E: getCompanyRoleIncludingInvited
    // now resolves ACTIVE memberships only, so an INVITED membership of any role no
    // longer reaches this branch — invited memberships confer nothing before acceptance.
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role: role as string };
}
