import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/social-accounts/disconnect
 * Deactivates a social_accounts row for the current user.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  const { platform } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform required' });
  const normalizedPlatform = String(platform).toLowerCase().trim();
  const platformAliases = normalizedPlatform === 'x' || normalizedPlatform === 'twitter'
    ? ['x', 'twitter']
    : [normalizedPlatform];

  // Do NOT null access_token/refresh_token: the column has a NOT NULL
  // constraint in production, so the entire UPDATE rejects and the
  // disconnect appears to silently fail. The encrypted tokens on an
  // is_active=false row are harmless — reconnect overwrites them.
  const updatePayload = {
    is_active: false,
    status: 'disconnected',
    updated_at: new Date().toISOString(),
  };

  // Chain .select() so the update returns the affected rows. Without this,
  // Supabase happily returns no error when zero rows match — the API would
  // 200 OK and the UI would falsely claim "disconnected" while nothing changed.
  // This is the failure mode when the row's user_id doesn't match the caller
  // (duplicate users rows, or a row created under a different supabase_uid).
  let { data: updatedRows, error: dbErr } = await supabase
    .from('social_accounts')
    .update(updatePayload)
    .eq('user_id', userId)
    .in('platform', platformAliases)
    .eq('is_active', true)
    .not('platform_user_id', 'like', 'planning_%')
    .select('id');

  if (dbErr && /column .* does not exist|Could not find .* column|schema cache/i.test(dbErr.message ?? '')) {
    const fallback = await supabase
      .from('social_accounts')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('platform', platformAliases)
      .eq('is_active', true)
      .not('platform_user_id', 'like', 'planning_%')
      .select('id');
    dbErr = fallback.error;
    updatedRows = fallback.data;
  }

  if (dbErr) {
    console.error('[social-accounts/disconnect]', dbErr);
    return res.status(500).json({ error: dbErr.message });
  }

  const disconnectedCount = updatedRows?.length ?? 0;
  if (disconnectedCount === 0) {
    // Surface the silent-no-op so the UI can show the user the truth instead
    // of a false success toast. The most common cause is a row owned by a
    // different users.id (duplicate users rows for the same human).
    return res.status(404).json({
      error:
        `No active ${normalizedPlatform} account found for your user. ` +
        `The connection may belong to a different login — check the users table for duplicates.`,
      disconnected: 0,
    });
  }

  return res.status(200).json({ success: true, disconnected: disconnectedCount });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/social-accounts/disconnect' });
