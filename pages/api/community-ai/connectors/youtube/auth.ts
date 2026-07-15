import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';
import { encodeOAuthState } from '../../../../../backend/auth/oauthState';
import { getBaseUrl } from '../../../../../backend/auth/getBaseUrl';

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

  const credentials = await getOAuthCredentialsForPlatform('youtube');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'YouTube OAuth is not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  const redirectTo =
    typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';

  const state = encodeOAuthState({
    companyId: organizationId,
    userId: access.userId,
    tenantId: organizationId,
    flow: 'community-ai',
    returnTo: redirectTo,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${getBaseUrl(req)}/api/auth/youtube/callback`,
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ].join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return res.redirect(oauthUrl);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/youtube/auth' });
