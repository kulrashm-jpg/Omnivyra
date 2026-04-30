import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { syncInstagramAndThreadsFromMeta } from '../../../../backend/services/metaDerivedAccountsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const { returnTo: earlyReturnTo } = decodeOAuthState(state as string);
  const errDest = earlyReturnTo && earlyReturnTo.startsWith('/') ? earlyReturnTo : '/social-platforms';

  if (error) return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  if (!code) return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);

  try {
    const platform = 'instagram';
    const { companyId, userId: stateUserId, returnTo } = decodeOAuthState(state as string);

    const oauthCredentials = await getOAuthCredentialsForPlatform('instagram');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Instagram OAuth not configured - ask your Super Admin to add Meta credentials.')}`);
    }

    const tokenResponse = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/instagram/callback`,
        code: code as string,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? 'Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    const longLivedResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: oauthCredentials.client_id,
          client_secret: oauthCredentials.client_secret,
          fb_exchange_token: tokenData.access_token,
        })
    );
    const longLivedData = longLivedResponse.ok ? await longLivedResponse.json() : tokenData;
    const accessToken = longLivedData.access_token ?? tokenData.access_token;

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';
    if (!userId) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required - please log in and try again')}`);
    }

    const expiresIn = longLivedData.expires_in || tokenData.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const permissions = String(tokenData.scope || longLivedData.scope || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const syncResult = await syncInstagramAndThreadsFromMeta({
      userId,
      companyId: companyId || null,
      accessToken,
      expiresAt,
      permissions,
    });

    if (syncResult.instagramAccounts.length === 0) {
      throw new Error('No Instagram Business account found. Connect a Facebook Page with an Instagram Business account to enable Instagram and Threads.');
    }

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId).catch((e) =>
        console.warn('[instagram/callback] setup credits check failed:', e?.message)
      );
    }

    const successDest = returnTo && returnTo.startsWith('/') ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    const accountName = syncResult.instagramAccounts[0]?.username || syncResult.instagramAccounts[0]?.name || 'Instagram';
    return res.redirect(`${successDest}${sep}connected=${platform}&threads=${syncResult.threadsAccounts.length > 0 ? 'enabled' : 'disabled'}&account=${encodeURIComponent(accountName)}&success=true`);
  } catch (err: any) {
    console.error('Instagram OAuth callback error:', err);
    return res.redirect(`${errDest}?error=${encodeURIComponent(err.message || 'Connection failed')}`);
  }
}
