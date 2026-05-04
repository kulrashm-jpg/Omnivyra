/**
 * GET /api/admin/super-admins
 *
 * Returns the list of users with SUPER_ADMIN role.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import { getPlatformSuperAdminRoleRows } from '../../../backend/services/rbacService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'users:list-external');
  if (!ctx) return;

  try {
    const admins = await getPlatformSuperAdminRoleRows();
    return res.status(200).json({ success: true, admins });
  } catch (err: any) {
    console.error('[super-admins] unexpected error:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
