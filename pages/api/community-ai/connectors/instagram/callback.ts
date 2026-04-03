import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/community-ai/connectors/instagram/callback  (legacy — redirects to Meta unified callback)
 *
 * Instagram is connected via the unified Meta OAuth flow.
 * Canonical callback: /api/community-ai/connectors/meta/callback
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/community-ai/connectors/meta/callback${qs}`);
}
