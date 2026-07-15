import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';
import { getCanonicalOAuthRedirectUri } from '../../../backend/auth/getCanonicalOAuthRedirectUri';
import { encodeOAuthState } from '../../../backend/auth/oauthState';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const platform = 'linkedin';

    // Resolve credentials from platform config (DB) or .env fallback
    const credentials = await getOAuthCredentialsForPlatform(platform);
    const clientId = credentials?.client_id;

    if (!clientId || clientId.includes('your_')) {
      return res.redirect(
        `/social-platforms?error=${encodeURIComponent(
          'LinkedIn not configured. Ask your Super Admin to add OAuth credentials in the APIs settings.'
        )}`
      );
    }

    const state = encodeOAuthState({ companyId, userId, returnTo });

    const redirectUri = getCanonicalOAuthRedirectUri('linkedin', req);
    console.log('[LinkedIn OAuth] ── credentials source:', credentials?.source);
    console.log('[LinkedIn OAuth] ── client_id:', clientId);
    console.log('[LinkedIn OAuth] ── redirect_uri:', redirectUri);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'openid profile email w_member_social',
    });

    const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    res.redirect(oauthUrl);
  } catch (error: any) {
    console.error('LinkedIn OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/linkedin' });
