import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';

/**
 * GET /api/community-ai/connectors/meta/auth
 *
 * Unified Meta OAuth — connects Facebook, Instagram, and WhatsApp Business in one flow.
 * All three platforms share the same Meta (Facebook) App credentials and access token.
 *
 * Required scopes:
 *   Facebook  — pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement
 *   Instagram — instagram_basic, instagram_manage_comments, instagram_manage_insights, instagram_content_publish
 *   WhatsApp  — whatsapp_business_management, whatsapp_business_messaging
 *
 * Register callback URL in Meta Developer Console:
 *   {baseUrl}/api/community-ai/connectors/meta/callback
 */

const buildState = (value: Record<string, string>) => {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const META_SCOPES = [
  // Facebook Pages
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  // Instagram
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_content_publish',
  // WhatsApp Business
  'whatsapp_business_management',
  'whatsapp_business_messaging',
  // Base
  'public_profile',
].join(',');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : '';
  const organizationId = typeof req.query.organization_id === 'string' ? req.query.organization_id : '';
  if (!tenantId || !organizationId || tenantId !== organizationId) {
    return res.status(400).json({ error: 'tenant_id and organization_id are required' });
  }

  const access = await requireManageConnectors(req, res, organizationId);
  if (!access) return;

  // Meta uses Facebook App credentials
  const credentials = await getOAuthCredentialsForPlatform('meta');
  const clientId = credentials?.client_id;
  if (!clientId) {
    return res.status(500).json({
      error: 'Meta OAuth not configured. Super Admin must add FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET (or configure in platform_oauth_configs).',
    });
  }

  const redirectUri = getCommunityAiConnectorCallbackUrl('meta', req);
  const redirectTo = typeof req.query.redirect === 'string' ? req.query.redirect : '/community-ai/connectors';
  const state = buildState({ tenant_id: tenantId, organization_id: organizationId, redirect: redirectTo });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: META_SCOPES,
    state,
  });

  return res.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`);
}
