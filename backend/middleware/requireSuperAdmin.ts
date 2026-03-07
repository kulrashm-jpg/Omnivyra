/**
 * Require Super Admin authorization for API handlers.
 * Phase-2: Super Admin Governance Layer
 *
 * Replicates auth logic used by /api/super-admin/* routes.
 * 1. Legacy cookie: req.cookies.super_admin_session === '1'
 * 2. Otherwise: getSupabaseUserFromRequest + isPlatformSuperAdmin
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../services/rbacService';

/**
 * Check super admin authorization. Returns true if authorized.
 * If not authorized, sends 403 and returns false.
 */
export async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') {
    return true;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) {
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}
