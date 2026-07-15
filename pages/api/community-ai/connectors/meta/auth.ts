import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireManageConnectors, getCommunityAiConnectorCallbackUrl } from '../utils';
import { getOAuthCredentialsForPlatform } from '../../../../../backend/auth/oauthCredentialResolver';

/**
 * GET /api/community-ai/connectors/meta/auth
 *
 * Meta OAuth handler — Facebook and Instagram share the same Meta Developer
 * App credentials, but each connect flow MUST request only its own
 * provider-compatible scope set. Meta rejects the consent dialog with
 * "Invalid Scopes: instagram_*" when Instagram-only scopes are requested
 * during a Facebook connect flow on an app whose Instagram products aren't
 * fully provisioned — that contamination is what this handler now prevents.
 *
 * Provider discrimination is mandatory: the caller passes `?provider=facebook`
 * or `?provider=instagram`. The legacy redirect routes at
 * /api/community-ai/connectors/{facebook,instagram}/auth append this param
 * before forwarding. Requests without `provider` fall back to the strictest
 * Facebook-only set so a missing param can never re-introduce cross-platform
 * contamination.
 *
 * Threads is intentionally excluded — it's derived server-side from
 * Instagram (via meta_oauth_connections) and never requests its own scopes.
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

// Facebook-only scopes. Strictly no instagram_*, no threads_*.
const FACEBOOK_SCOPES: ReadonlyArray<string> = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'business_management',
  'public_profile',
];

// Instagram-only scopes. The two Page scopes are intentional — Meta's
// /me/accounts hop to discover the Instagram Business account requires
// pages_show_list, and business_management is needed when the Page is owned
// by a Business Portfolio. NO Facebook posting scopes.
const INSTAGRAM_SCOPES: ReadonlyArray<string> = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'pages_show_list',
  'business_management',
  'public_profile',
];

type MetaProvider = 'facebook' | 'instagram';

function resolveProvider(raw: unknown): MetaProvider {
  if (raw === 'instagram') return 'instagram';
  // Anything else (including the empty/legacy case) → Facebook-only.
  // Strictest default so a missing/unknown provider param cannot re-merge.
  return 'facebook';
}

function scopesForProvider(provider: MetaProvider): string {
  switch (provider) {
    case 'instagram': return INSTAGRAM_SCOPES.join(',');
    case 'facebook':  return FACEBOOK_SCOPES.join(',');
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  const provider = resolveProvider(req.query.provider);
  const state = buildState({
    tenant_id: tenantId,
    organization_id: organizationId,
    redirect: redirectTo,
    provider,   // propagate so the callback knows which surface initiated
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopesForProvider(provider),
    state,
  });

  return res.redirect(`https://www.facebook.com/v22.0/dialog/oauth?${params.toString()}`);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/community-ai/connectors/meta/auth' });
