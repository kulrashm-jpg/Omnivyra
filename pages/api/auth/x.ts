import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { encodeOAuthState } from '../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getOAuthRedirectBase } from '../../../backend/auth/oauthRedirectBase';

const base64Url = (input: Buffer) =>
  input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

// SEC91-W2B-2: production → the configured canonical app URL only; development → the
// request origin with localhost spelled 127.0.0.1 (X requires it). Must match the value
// /api/auth/x/callback uses for the token exchange.
function getXRedirectBase(req: NextApiRequest) {
  return getOAuthRedirectBase(req, { loopback: '127.0.0.1' });
}

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

    const credentials = await getOAuthCredentialsForPlatform('x');
    if (!credentials?.client_id) {
      return res.status(400).json({ error: 'X OAuth not configured - ask your Super Admin to add credentials.' });
    }

    const returnTo = (req.query.returnTo as string) || '';
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = encodeOAuthState({ companyId, userId: user.id, returnTo, codeVerifier });

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/x' });
