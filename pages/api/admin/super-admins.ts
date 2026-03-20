/**
 * GET /api/admin/super-admins
 *
 * Returns the list of users with SUPER_ADMIN role.
 * Auth: requireSuperAdmin — only another super-admin may enumerate the roster.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireSuperAdmin } from '../../../backend/middleware/authMiddleware';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: super-admin only ────────────────────────────────────────────────
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  try {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('user_id, role, company_id, created_at, status')
      .eq('role', 'SUPER_ADMIN')
      .eq('status', 'active');

    if (error) {
      console.error('[super-admins] fetch error:', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ success: true, admins: data ?? [] });
  } catch (err: any) {
    console.error('[super-admins] unexpected error:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
