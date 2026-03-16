import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/community-ai/connectors/instagram/auth  (legacy — redirects to Meta unified connector)
 *
 * Instagram is now connected via the unified Meta OAuth flow (same Facebook App).
 * Canonical: /api/community-ai/connectors/meta/auth
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/community-ai/connectors/meta/auth${qs}`);
}
