import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/community-ai/connectors/facebook/auth  (legacy — redirects to Meta unified connector)
 *
 * Facebook, Instagram, and WhatsApp share the same Meta Developer App, but
 * each connect flow MUST request only its own provider-compatible scopes.
 * Forward to the unified handler with `provider=facebook` so it requests the
 * Facebook-only scope set — Meta rejects the consent dialog with "Invalid
 * Scopes" when Instagram-only scopes (e.g. instagram_manage_insights) are
 * requested during a Facebook connect flow.
 *
 * Canonical: /api/community-ai/connectors/meta/auth
 */
function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = new URL(req.url || '/', 'http://placeholder');
  url.searchParams.set('provider', 'facebook');
  return res.redirect(301, `/api/community-ai/connectors/meta/auth${url.search}`);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/facebook/auth' });
