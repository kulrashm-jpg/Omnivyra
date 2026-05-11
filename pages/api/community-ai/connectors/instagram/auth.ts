import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/community-ai/connectors/instagram/auth  (legacy — redirects to Meta unified connector)
 *
 * Instagram is connected via the same Meta Developer App as Facebook, but
 * requests its own provider-specific scope set. Forward to the unified
 * handler with `provider=instagram` so it requests the Instagram-only
 * scope subset (NOT a merged Facebook+Instagram superset, which Meta
 * rejects with "Invalid Scopes" when Instagram products aren't fully
 * configured on the app).
 *
 * Canonical: /api/community-ai/connectors/meta/auth
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = new URL(req.url || '/', 'http://placeholder');
  url.searchParams.set('provider', 'instagram');
  return res.redirect(301, `/api/community-ai/connectors/meta/auth${url.search}`);
}
