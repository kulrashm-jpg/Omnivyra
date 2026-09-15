import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

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

    const credentials = await getOAuthCredentialsForPlatform('tiktok');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'TikTok OAuth not configured — ask your Super Admin to add credentials.' });
    }

    const returnTo = (req.query.returnTo as string) || '';
    const state = encodeOAuthState({ companyId, userId: user.id, returnTo });

    const params = new URLSearchParams({
      client_key: credentials.client_id,
      redirect_uri: `${getBaseUrl(req)}/api/auth/tiktok/callback`,
      scope: 'user.info.basic,video.list,video.upload',
      response_type: 'code',
      state,
    });

    res.redirect(`https://www.tiktok.com/v2/auth/authorize?${params.toString()}`);
  } catch (error: any) {
    console.error('TikTok OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/tiktok' });
