/**
 * Require Super Admin authorization for API handlers.
 * Phase-2: Super Admin Governance Layer
 *
 * Delegates to `requireSuperAdminUser` (requestAccessService): canonical
 * authenticated identity + isPlatformSuperAdmin. It does NOT read the legacy
 * bridge cookie.
 *
 * SEC-001B: this header previously documented a `req.cookies.super_admin_session
 * === '1'` step that the code has not performed for some time. Corrected so the
 * comment cannot be cited as evidence that a raw-cookie path still exists here.
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
