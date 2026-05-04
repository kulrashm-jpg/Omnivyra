import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/extension/health
 *
 * Signed health ping from the extension service worker. Returns 200 when
 * the backend is reachable and the caller's session + HMAC signature are
 * valid. Any 401/403/5xx is an honest "backend not reachable for this
 * session" signal the extension can surface.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;

  return res.status(200).json({
    success: true,
    ok: true,
    now: new Date().toISOString(),
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

