import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { encodeOAuthState } from '../../../../../backend/auth/oauthState';
import crypto from 'crypto';

const base64Url = (input: Buffer) =>
  input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const credentials = await getOAuthCredentialsForPlatform('twitter');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'Twitter OAuth is not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  // Derive callback URL from the actual request host so localhost and production
  // both resolve to a URL that is already registered in the Twitter app.
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost:3000';
  const redirectUri = `${proto}://${host}/api/auth/twitter/callback`;

  const redirectTo =
    typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';

  // Embed flow marker + PKCE code_verifier + tenant context so the shared callback
  // knows to use PKCE and also save to community_ai_platform_tokens.
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
