
/**
 * POST /api/auth/sync-firebase-user
 *
 * DEPRECATED — Firebase has been removed. This endpoint is a no-op stub kept
 * for backwards compatibility. Any client still calling this route will receive
 * a 410 Gone response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return res.status(410).json({ error: 'DEPRECATED', message: 'Firebase auth has been removed. Use Supabase auth.' });
}
