import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/social/linkedin/auth  (legacy — redirects to canonical OAuth route)
 *
 * The canonical LinkedIn OAuth flow is at /api/auth/linkedin.
 * Update your LinkedIn Developer App callback URL to:
 *   {baseUrl}/api/auth/linkedin/callback
 */
function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/auth/linkedin${qs}`);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/social/linkedin/auth' });
