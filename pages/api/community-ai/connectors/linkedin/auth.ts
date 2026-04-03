import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { encodeOAuthState } from '../../../../../backend/auth/oauthState';

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

  const credentials = await getOAuthCredentialsForPlatform('linkedin');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'LinkedIn OAuth not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  // Derive callback URL from the actual request host so localhost and production
  // both resolve to a URL that is already registered in the LinkedIn app.
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost:3000';
  const redirectUri = `${proto}://${host}/api/auth/linkedin/callback`;

  const redirectTo =
    typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';

  // Embed flow marker + tenant context so the shared callback knows to also
  // save to community_ai_platform_tokens and redirect to the connectors page.
  const state = encodeOAuthState({
    companyId: organizationId,
    userId: access.userId,
    tenantId: organizationId,
    flow: 'community-ai',
    returnTo: redirectTo,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email w_member_social',
    state,
  });

  const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  return res.redirect(oauthUrl);
}
