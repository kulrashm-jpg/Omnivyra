/**
 * POST /api/analytics/track
 * Lightweight event tracking endpoint for client-side analytics events.
 * Accepts CommandCenterEvent and similar payloads; logs and returns 200.
 * Fire-and-forget: clients do not need to await a meaningful response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Best-effort: log to server console for observability; never reject.
  try {
    const { eventName, userId, companyId } = req.body ?? {};
    if (eventName) {
      console.info('[analytics/track]', { eventName, userId, companyId });
    }
  } catch {
    // Ignore parse errors
  }

  return res.status(200).json({ ok: true });
}
