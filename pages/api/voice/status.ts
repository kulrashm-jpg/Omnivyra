import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isVoiceTranscribeEnabled } from '../../../backend/services/voice/transcriptionLimits';

/**
 * GET /api/voice/status -> { enabled } (e9 2026-11-14). The UI renders the mic / Record only when enabled === true
 * and fails CLOSED otherwise (loading, error, 404). Signed-in callers only; the switch is global (server env
 * VOICE_TRANSCRIBE_ENABLED, default off) and reveals nothing tenant-specific.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getSupabaseUserFromRequest(req);
  // Deliberate (05): "auth errored" and "no user" collapse into ONE 401 here - distinguishing them would disclose more
  // (whether a token was well-formed) for an endpoint whose only payload is a global boolean.
  if (error || !user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json({ enabled: isVoiceTranscribeEnabled() });
}

export default __createApiRoute(handler, { route: '/api/voice/status' });
