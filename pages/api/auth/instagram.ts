// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately
import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentials = await getOAuthCredentialsForPlatform('instagram');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'Instagram OAuth not configured â€” ask your Super Admin to add credentials.' });
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
        'pages_manage_posts',
        'pages_read_user_content',
        'pages_messaging',
        'instagram_basic',
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

