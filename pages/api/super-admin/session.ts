/**
 * GET /api/super-admin/session
 *
 * Returns whether the authenticated caller is a confirmed platform super-admin.
 * Replaces the legacy cookie check (super_admin_session=1).
 *
 * Auth: Bearer <supabase_access_token>
 * Response: { isSuperAdmin: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase as adminSupabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(200).json({ isSuperAdmin: false });

  // Check profiles.is_super_admin via service role (bypasses RLS)
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  return res.status(200).json({ isSuperAdmin: profile?.is_super_admin === true });
}
