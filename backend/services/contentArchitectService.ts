import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getUserRole, getCompanyRoleIncludingInvited, isSuperAdmin, Role } from './rbacService';

/**
 * Content Architect: platform-level role (next to Super Admin) with access to all companies'
 * content to help refine strategy or campaigns. Identified by content_architect_session cookie.
 */

/**
 * True when the request has a valid Content Architect session (can access companies/campaigns).
 */
export function isContentArchitectSession(req: NextApiRequest): boolean {
  return req.cookies?.content_architect_session === '1';
}

/**
 * Returns the pinned company ID if the request is a Content Architect session
 * with a company cookie set; otherwise null (session can still be architect with access to all companies).
 */
export function getContentArchitectCompanyId(req: NextApiRequest): string | null {
  const session = req.cookies?.content_architect_session;
  const companyId = req.cookies?.content_architect_company_id;
  if (session !== '1' || !companyId) return null;
  return typeof companyId === 'string' ? companyId : null;
}

/**
 * Content Architect is a platform-level role (next to Super Admin) with access to all companies'
 * content so they can help any company refine strategy or campaigns.
 *
 * If the request has a valid Content Architect session, grants access to the requested company
 * (any company). The content_architect_company_id cookie is for UI default only, not for gating.
 */
export function checkContentArchitectAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string | null | undefined
): { userId: string; role: string } | null | undefined {
  if (!isContentArchitectSession(req)) return undefined;
  if (!companyId) return undefined;
  return { userId: 'content_architect', role: 'CONTENT_ARCHITECT' };
}

/**
 * Resolve company access for any request: Content Architect (cookie) or Supabase user with role.
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
  const archAccess = checkContentArchitectAccess(req, res, companyId);
  if (archAccess === null) return null;
  if (archAccess) return archAccess;
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
    if (
      fallbackRole === Role.COMPANY_ADMIN ||
      fallbackRole === Role.ADMIN ||
      fallbackRole === Role.SUPER_ADMIN
    ) {
      role = fallbackRole;
      roleError = null;
    }
  }
  if (roleError || !role) {
    if (isContentArchitectSession(req)) {
      return { userId: 'content_architect', role: 'CONTENT_ARCHITECT' };
    }
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role: role as string };
}
