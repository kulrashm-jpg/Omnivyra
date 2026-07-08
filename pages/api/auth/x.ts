import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { encodeOAuthState } from '../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';

const base64Url = (input: Buffer) =>
  input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function getXRedirectBase(req: NextApiRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string) || 'localhost:3000';
  return `${proto}://${host}`.replace(/\/$/, '').replace('://localhost:', '://127.0.0.1:');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentials = await getOAuthCredentialsForPlatform('x');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'X OAuth not configured - ask your Super Admin to add credentials.' });
    }

    const companyId = (req.query.companyId as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const returnTo = (req.query.returnTo as string) || '';
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = encodeOAuthState({ companyId, userId, returnTo, codeVerifier });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.client_id,
      redirect_uri: `${getXRedirectBase(req)}/auth/x/callback`,
      state,
      scope: 'tweet.read tweet.write media.write users.read like.write follows.write offline.access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
  } catch (error: any) {
    console.error('X OAuth initiation error:', error);
    res.status(500).json({ error: error.message });
  }
}
