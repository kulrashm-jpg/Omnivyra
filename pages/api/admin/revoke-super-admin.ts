/**
 * POST /api/admin/revoke-super-admin
 *
 * Super-admin only. Revokes platform super-admin status from a user by:
 *  1. Setting profiles.is_super_admin = false
 *  2. Downgrading any SUPER_ADMIN role in user_company_roles to COMPANY_ADMIN
 *
 * Body: { userId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '@/backend/middleware/authMiddleware';
import { supabase } from '@/backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { userId } = body as { userId?: string };

  if (!userId) return res.status(400).json({ error: 'Missing required field: userId' });

  try {
    const now = new Date().toISOString();

    // 1. Revoke super-admin flag on the profile
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ is_super_admin: false, updated_at: now })
      .eq('id', userId);

    if (profileErr) {
      console.error('[revoke-super-admin] profile update failed:', profileErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // 2. Downgrade any SUPER_ADMIN company roles to COMPANY_ADMIN
    await supabase
      .from('user_company_roles')
      .update({ role: 'COMPANY_ADMIN', updated_at: now })
      .eq('user_id', userId)
      .eq('role', 'SUPER_ADMIN');

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
