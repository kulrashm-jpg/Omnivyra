/**
 * Shared Super Admin authorization for the GA endpoints.
 *
 * Unifies what `ga-connect`, `ga-select-property`, and `ga-analytics-summary`
 * use so they no longer give asymmetric outcomes for the same caller.
 *
 * Auth rule (single source of truth):
 *   1. Legacy bridge cookie `super_admin_session=1` is accepted (matches
 *      pages/api/super-admin/login.ts behavior).
 *   2. Otherwise the caller must be a Supabase user whose `user_company_roles`
 *      contains a SUPER_ADMIN row (delegated to rbacService.isPlatformSuperAdmin).
 *      No `status='active'` filter — that filter was the source of the
 *      "valid Super Admin gets 403 from /ga-connect but 200 from
 *      /ga-analytics-summary" bug.
 *
 * On failure this writes a standardized error JSON:
 *   { status: 'error', code, message }
 * and returns null. Callers should bail out when the result is null.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin } from './rbacService';
import { getSupabaseUserFromRequest } from './supabaseAuthService';

export type SuperAdminGaPrincipal = {
  userId: string | null;
  via: 'cookie' | 'supabase';
};

export async function requireSuperAdminGaAccess(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<SuperAdminGaPrincipal | null> {
  if (req.cookies?.super_admin_session === '1') {
    return { userId: null, via: 'cookie' };
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(403).json({
      status: 'error',
      code: 'GA_NOT_AUTHENTICATED',
      message: 'Super admin sign-in is required to manage Google Analytics.',
    });
    return null;
  }

  const allowed = await isPlatformSuperAdmin(user.id);
  if (!allowed) {
    res.status(403).json({
      status: 'error',
      code: 'GA_FORBIDDEN_ROLE',
      message: 'Your account is not a platform Super Admin and cannot manage Google Analytics.',
    });
    return null;
  }

  return { userId: user.id, via: 'supabase' };
}
