import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/social/linkedin/auth
 *
 * Redirects user to LinkedIn OAuth consent page.
 * After authorization, LinkedIn redirects to /api/social/linkedin/callback?code=...
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/social/linkedin/callback';

  if (!clientId) {
    return res.status(500).json({
      error: 'LINKEDIN_CLIENT_ID not configured in environment',
    });
  }

  const state = `social_linkedin_${Date.now()}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'r_liteprofile r_emailaddress w_member_social',
  });

  const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  res.redirect(oauthUrl);
}
