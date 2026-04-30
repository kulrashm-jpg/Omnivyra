import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentials = await getOAuthCredentialsForPlatform('facebook');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'Facebook OAuth not configured — ask your Super Admin to add credentials.' });
    }

    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const state = encodeOAuthState({ companyId, userId, returnTo });

    const params = new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: `${getBaseUrl(req)}/api/auth/facebook/callback`,
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,instagram_basic,instagram_content_publish,public_profile',
      response_type: 'code',
      state,
    });

    res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`);
  } catch (error: any) {
    console.error('Facebook OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}
