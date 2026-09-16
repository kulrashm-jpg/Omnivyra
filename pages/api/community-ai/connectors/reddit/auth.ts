import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl, mintConnectorOAuthState } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : '';
  const organizationId =
    typeof req.query.organization_id === 'string' ? req.query.organization_id : '';
  if (!tenantId || !organizationId || tenantId !== organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id are required' });
  }

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  const credentials = await getOAuthCredentialsForPlatform('reddit');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'Reddit OAuth is not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  const redirectUri = getCommunityAiConnectorCallbackUrl('reddit', req);
  // SEC91-B5: HMAC-signed state (company + tenant + session user, 10-min TTL, validated
  // same-origin redirect) instead of unsigned base64 JSON.
  const state = mintConnectorOAuthState({
    organizationId,
    userId: access.userId,
    redirect: req.query.redirect,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: redirectUri,
    duration: 'permanent',
    scope: 'identity read submit vote subscribe',
  });

  const oauthUrl = `https://www.reddit.com/api/v1/authorize?${params.toString()}`;
  return res.redirect(oauthUrl);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/reddit/auth' });
