import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentials = await getOAuthCredentialsForPlatform('instagram');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'Instagram OAuth not configured — ask your Super Admin to add credentials.' });
    }

    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const state = encodeOAuthState({ companyId, userId, returnTo });

    const params = new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: `${getBaseUrl(req)}/api/auth/instagram/callback`,
      // business_management is required when the Facebook Page is owned by a
      // Business Portfolio (Meta Business Suite). Without it, /me/accounts
      // returns empty even when the user is a Page admin, and the callback
      // throws "No Instagram Business account found".
      scope: [
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_manage_insights',
        'instagram_content_publish',
        'business_management',
      ].join(','),
      response_type: 'code',
      state,
    });

    res.redirect(`https://www.facebook.com/v22.0/dialog/oauth?${params.toString()}`);

  } catch (error: any) {
    console.error('Instagram OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/instagram' });
