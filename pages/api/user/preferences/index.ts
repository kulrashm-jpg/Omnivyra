
/**
 * GET /api/user/preferences
 *
 * Fetch user's UI preferences (default landing page, command center pin status).
 * Used on every page load to restore user preferences.
 *
 * Returns: UserPreferences object or null if not found
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserPreferences } from '@/backend/services/userPreferencesService';

export interface UserPreferencesResponse {
  success: true;
  preferences: {
    id: string;
    user_id: string;
    default_landing: 'command_center' | 'dashboard';
    command_center_pinned: boolean;
    created_at: string;
    updated_at: string;
  } | null;
}

type ErrorResponse = {
  error: string;
  code?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserPreferencesResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify user is authenticated ───────────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);

  if (userErr || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_SESSION' });
  }

  // ── 2. Fetch preferences ──────────────────────────────────────────────────
  try {
    const preferences = await getUserPreferences(user.id);

    return res.status(200).json({
      success: true,
      preferences: preferences || null,
    });
  } catch (err) {
    console.error('[preferences] error:', err);
    return res.status(500).json({
      error: 'Failed to fetch preferences',
      code: 'SERVER_ERROR',
    });
  }
}
