import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';
import { encodeOAuthState } from '../../../backend/auth/oauthState';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ROUTE-AUTH-001: the signed state names the user and company the callback
    // will write the connection for, so only an authenticated session may mint
    // it — for itself, and only for a company it is an active member of. The
    // client-supplied ?userId= is ignored.
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user?.id) {
      return res.status(401).json({ error: 'Login session required — please log in and try again' });
    }
    const companyId = (req.query.companyId as string) || undefined;
    if (companyId) {
      const access = await enforceCompanyAccess({ req, res, companyId });
      if (!access) return;
    }
    const userId = user.id;
    const returnTo = (req.query.returnTo as string) || '';
    const platform = 'youtube';

    const credentials = await getOAuthCredentialsForPlatform(platform);
    const clientId = credentials?.client_id;

    if (!clientId || clientId.includes('your_')) {
      return res.redirect(
        `/social-platforms?error=${encodeURIComponent(
          'YouTube not configured. Ask your Super Admin to add OAuth credentials in the APIs settings.'
        )}`
      );
    }

    const state = encodeOAuthState({ companyId, userId, returnTo });

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
    res.redirect(oauthUrl);
  } catch (error: any) {
    console.error('YouTube OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/youtube' });
