import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const companyId = (req.query.companyId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const platform = 'linkedin';

    // Resolve credentials from platform config (DB) or .env fallback
    const credentials = await getOAuthCredentialsForPlatform(platform);
    const clientId = credentials?.client_id;

    if (!clientId || clientId.includes('your_')) {
      return res.redirect(
        `/creative-scheduler?error=${encodeURIComponent(
          'LinkedIn not configured. Add OAuth Client ID & Secret in Social Platform Settings for your company.'
        )}`
      );
    }

    const stateBase = companyId ? `c:${companyId}:linkedin:${Date.now()}` : `linkedin_${Date.now()}`;
    const state = returnTo ? `${stateBase}|${returnTo}` : stateBase;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/linkedin/callback`,
      state,
      scope: 'r_liteprofile r_emailaddress w_member_social',
    });

    const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    res.redirect(oauthUrl);
  } catch (error: any) {
    console.error('LinkedIn OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}
