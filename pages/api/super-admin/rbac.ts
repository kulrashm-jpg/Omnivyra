import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin, getRbacConfig, saveRbacConfig } from '../../../backend/services/rbacService';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdminAccess(req, res))) return;

  if (req.method === 'GET') {
    const config = await getRbacConfig();
    return res.status(200).json(config);
  }

  if (req.method === 'POST') {
    const { user } = await getSupabaseUserFromRequest(req);
    const { roles, permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions_required' });
    }
    try {
      const updated = await saveRbacConfig({
        roles: Array.isArray(roles) ? roles : [],
        permissions,
        updatedBy: user?.id || null,
      });
      return res.status(200).json(updated);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update RBAC config' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
