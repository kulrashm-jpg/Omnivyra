/**
 * Closure-015C (P1) — containment for withRBAC([SUPER_ADMIN]) routes whose
 * effect is platform-wide or cross-tenant.
 *
 * withRBAC → enforceRole admits two principals for [SUPER_ADMIN]: an ACTIVE
 * platform super admin (the hasActiveSuperAdminRow bypass) and, through
 * getUserRole's invited-admin fallback, a user whose SUPER_ADMIN membership in
 * the request's companyId is only INVITED. That second principal is
 * company-scoped; it must never authorize an effect beyond that company.
 *
 * Run inside such a handler, after withRBAC: it re-applies the platform
 * predicate (rbacService.isPlatformSuperAdmin — active, exact SUPER_ADMIN; a
 * lookup error fails closed) to the authorized user, so only the first
 * principal proceeds. It adds no capability and no new policy: these routes
 * already declare SUPER_ADMIN-only; this removes the company-scoped path into
 * them. The shared withRBAC / getUserRole behaviour is unchanged.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin } from '../services/rbacService';

export async function requireActivePlatformSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
  operation: string,
): Promise<boolean> {
  const userId = (req as NextApiRequest & { rbac?: { userId?: string } }).rbac?.userId;
  if (userId && (await isPlatformSuperAdmin(userId))) return true;
  res.status(403).json({ error: 'Forbidden', code: 'PLATFORM_SUPER_ADMIN_REQUIRED', operation });
  return false;
}
