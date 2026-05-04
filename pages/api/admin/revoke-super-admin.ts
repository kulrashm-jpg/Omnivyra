
/**
 * POST /api/admin/revoke-super-admin
 *
 * Super-admin only. Downgrades any SUPER_ADMIN role in user company roles to
 * COMPANY_ADMIN. The legacy `profiles.is_super_admin` flag is no longer
 * canonical and has been retired.
 *
 * Body: { userId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { downgradePlatformSuperAdminRoles } from '@/backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'users:super-admin-revoke');
  if (!ctx) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { userId } = body as { userId?: string };

  if (!userId) return res.status(400).json({ error: 'Missing required field: userId' });

  try {
    const now = new Date().toISOString();

    await downgradePlatformSuperAdminRoles(userId, now);

    return res.status(200).json({
      success:    true,
      message:    'Super admin privileges revoked successfully',
      user_id:    userId,
      revoked_at: now,
    });
  } catch (err: any) {
    console.error('[revoke-super-admin]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
