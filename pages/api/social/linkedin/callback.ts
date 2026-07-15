import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/social/linkedin/callback  (legacy — no longer used)
 *
 * LinkedIn OAuth callback is now handled at /api/auth/linkedin/callback.
 * Update your LinkedIn Developer App callback URL to:
 *   {baseUrl}/api/auth/linkedin/callback
 */
function handler(req: NextApiRequest, res: NextApiResponse) {
  // Preserve code/state/error params so the canonical callback can process them
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(302, `/api/auth/linkedin/callback${qs}`);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/social/linkedin/callback' });
