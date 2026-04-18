import { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentials = await getOAuthCredentialsForPlatform('tiktok');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'TikTok OAuth not configured — ask your Super Admin to add credentials.' });
    }

    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const state = encodeOAuthState({ companyId, userId, returnTo });

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