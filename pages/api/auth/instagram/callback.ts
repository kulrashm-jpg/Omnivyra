// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately
import type { NextApiRequest, NextApiResponse } from 'next';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';

/**
 * Instagram OAuth callback â€” DEPRECATED.
 *
 * In the new Meta OAuth model, Instagram and Threads are derived from the
 * Facebook OAuth flow (pages/api/auth/facebook/callback.ts) via /me/accounts
 * â†’ instagram_business_account â†’ threads_account. There is no longer a
 * stand-alone Instagram OAuth dialog.
 *
 * Old callers reaching this URL are bounced to the Facebook OAuth start with
 * the same state preserved.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { state } = req.query;
  const decoded = decodeOAuthState(typeof state === 'string' ? state : undefined);
  const returnTo = decoded.returnTo && decoded.returnTo.startsWith('/') ? decoded.returnTo : '/social-platforms';
  const params = new URLSearchParams();
  if (decoded.companyId) params.set('companyId', decoded.companyId);
  if (decoded.userId) params.set('userId', decoded.userId);
  if (returnTo) params.set('returnTo', returnTo);
  return res.redirect(`/api/auth/facebook?${params.toString()}`);
}

