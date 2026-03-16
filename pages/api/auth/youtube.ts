import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';
import { encodeOAuthState } from '../../../backend/auth/oauthState';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const platform = 'youtube';

    const credentials = await getOAuthCredentialsForPlatform(platform);
    const clientId = credentials?.client_id;

    if (!clientId || clientId.includes('your_')) {
      return res.redirect(
        `/creative-scheduler?error=${encodeURIComponent(
          'YouTube not configured. Add OAuth Client ID & Secret in Social Platform Settings for your company.'
        )}`
      );
    }

    const state = encodeOAuthState({ companyId, userId, returnTo });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${getBaseUrl(req)}/api/auth/youtube/callback`,
      scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.redirect(oauthUrl);
  } catch (error: any) {
    console.error('YouTube OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}























