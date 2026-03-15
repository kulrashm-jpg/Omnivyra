import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';

const buildState = (value: Record<string, string>) => {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

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

  const credentials = await getOAuthCredentialsForPlatform('reddit');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({ error: 'Reddit OAuth is not configured. Super Admin must configure platform_oauth_configs or env vars.' });
  }

  const redirectUri = getCommunityAiConnectorCallbackUrl('reddit');
  const redirectTo =
    typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';
  const state = buildState({
    tenant_id: tenantId,
    organization_id: organizationId,
    redirect: redirectTo,
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
