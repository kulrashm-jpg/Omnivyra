import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { encodeOAuthState } from '../../../../../backend/auth/oauthState';
import { getOAuthRedirectBase } from '../../../../../backend/auth/oauthRedirectBase';
import crypto from 'crypto';

const base64Url = (input: Buffer) =>
  input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

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

  const credentials = await getOAuthCredentialsForPlatform('x');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'X OAuth is not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  // X only allows one callback URL per app, so the connector flow reuses
  // /auth/x/callback (the shared bridge to /api/auth/x/callback) instead of
  // the standard /api/community-ai/connectors/x/callback path.
  // SEC91-W2B-2: production → the configured canonical app URL only; development →
  // the request origin with localhost spelled 127.0.0.1 (X requires it). Must match
  // the value /api/auth/x/callback uses for the token exchange.
  const redirectUri = `${getOAuthRedirectBase(req, { loopback: '127.0.0.1' })}/auth/x/callback`;

  const redirectTo =
    typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';

  const state = encodeOAuthState({
    companyId: organizationId,
    userId: access.userId,
    tenantId: organizationId,
    flow: 'community-ai',
    codeVerifier,
    returnTo: redirectTo,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read like.write follows.write offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const oauthUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  return res.redirect(oauthUrl);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/x/auth' });
