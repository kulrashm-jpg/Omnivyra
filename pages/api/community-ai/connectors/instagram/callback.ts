import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { logOAuthEvent, safeHost } from '../../../../../backend/auth/oauthTelemetry';

/**
 * GET /api/community-ai/connectors/instagram/callback  (legacy — redirects to Meta unified callback)
 *
 * Instagram is connected via the unified Meta OAuth flow.
 * Canonical callback: /api/community-ai/connectors/meta/callback
 */
function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestOrigin = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null;
  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'instagram',
    callback_host: safeHost(requestOrigin ? `https://${requestOrigin}` : null),
    state_flow: 'community-ai',
    request_origin: requestOrigin,
    failure_detail: 'legacy callback — redirecting to /api/community-ai/connectors/meta/callback',
  });
  const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `/api/community-ai/connectors/meta/callback${qs}`);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/instagram/callback' });
