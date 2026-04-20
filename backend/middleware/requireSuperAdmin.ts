/**
 * Require Super Admin authorization for API handlers.
 * Phase-2: Super Admin Governance Layer
 *
 * Replicates auth logic used by /api/super-admin/* routes.
 * 1. Legacy cookie: req.cookies.super_admin_session === '1'
 * 2. Otherwise: getSupabaseUserFromRequest + isPlatformSuperAdmin
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdminUser } from '../services/requestAccessService';

/**
 * Check super admin authorization. Returns true if authorized.
 * If not authorized, sends 403 and returns false.
 */
export async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  return !!(await requireSuperAdminUser(req, res));
}
