import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/community-ai/connectors/facebook/auth  (legacy â€” redirects to Meta unified connector)
 *
 * Facebook, Instagram, and WhatsApp are now connected via one Meta OAuth flow.
 * Canonical: /api/community-ai/connectors/meta/auth
 */
function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/community-ai/connectors/meta/auth${qs}`);
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

