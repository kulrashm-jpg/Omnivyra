/**
 * POST /api/social-accounts/disconnect
 * Deactivates a social_accounts row for the current user.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  const { platform } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform required' });

  const { error: dbErr } = await supabase
    .from('social_accounts')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('platform', String(platform).toLowerCase().trim())
    .eq('is_active', true)
    .not('platform_user_id', 'like', 'planning_%');

  if (dbErr) {
    console.error('[social-accounts/disconnect]', dbErr);
    return res.status(500).json({ error: dbErr.message });
  }

  return res.status(200).json({ success: true });
}
