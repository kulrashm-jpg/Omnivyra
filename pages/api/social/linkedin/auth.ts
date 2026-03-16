import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/social/linkedin/auth  (legacy — redirects to canonical OAuth route)
 *
 * The canonical LinkedIn OAuth flow is at /api/auth/linkedin.
 * Update your LinkedIn Developer App callback URL to:
 *   {baseUrl}/api/auth/linkedin/callback
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/auth/linkedin${qs}`);
}
