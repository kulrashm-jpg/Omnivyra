
/**
 * PATCH /api/user/preferences/command-center
 *
 * Update user's command center preferences
 * - pin/unpin the command center
 * - set whether to show it on next login
 *
 * Body: {
 *   command_center_pinned: boolean
 * }
 *
 * Returns: { success: true, preferences: UserPreferences }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { toggleCommandCenter } from '@/backend/services/userPreferencesService';

type SuccessResponse = {
  success: true;
  preferences: any;
};

type ErrorResponse = {
  error: string;
  code?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify user is authenticated ───────────────────────────────────────
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);

  if (userErr || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'INVALID_SESSION' });
  }

  // ── 2. Parse request body ─────────────────────────────────────────────────
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { command_center_pinned } = body as { command_center_pinned?: boolean };

  if (typeof command_center_pinned !== 'boolean') {
    return res.status(400).json({
      error: 'command_center_pinned must be a boolean',
      code: 'INVALID_REQUEST',
    });
  }

  // ── 3. Update preferences ─────────────────────────────────────────────────
  try {
    const updated = await toggleCommandCenter(user.id, command_center_pinned);

    if (!updated) {
      return res.status(500).json({
        error: 'Failed to update preferences',
        code: 'UPDATE_FAILED',
      });
    }

    return res.status(200).json({
      success: true,
      preferences: updated,
    });
  } catch (err) {
    console.error('[preferences/command-center] error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
}
