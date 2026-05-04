/**
 * Require Super Admin authorization for API handlers.
 *
 * Delegates to the service-layer super-admin gate.
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
