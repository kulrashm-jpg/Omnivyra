/**
 * GET /api/debug/oauth-info?platform=linkedin
 * Returns exactly what client_id + redirect_uri would be sent to the OAuth provider.
 * REMOVE THIS FILE before deploying to production.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';
import { getBaseUrl } from '../../../backend/auth/getBaseUrl';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const platform = (req.query.platform as string) || 'linkedin';
  const credentials = await getOAuthCredentialsForPlatform(platform);
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/${platform}/callback`;

  return res.status(200).json({
    platform,
    credentials_source: credentials?.source ?? 'NOT FOUND',
    client_id: credentials?.client_id ?? null,
    redirect_uri: redirectUri,
    base_url: baseUrl,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? '(not set)',
    note: 'Register redirect_uri exactly as shown above in your LinkedIn Developer App → Auth → Authorized Redirect URLs',
  });
}
