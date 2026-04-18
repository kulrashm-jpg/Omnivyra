/**
 * GET /api/auth/threads/callback
 *
 * Threads OAuth2 callback handler.
 * Flow:
 *   1. Exchange code for short-lived token (1h) via graph.threads.net/oauth/access_token
 *   2. Exchange short-lived → long-lived (60 days) via threads_exchange_token
 *   3. Fetch profile (GET /me?fields=id,username,threads_profile_audience_size)
 *   4. Upsert social_accounts row, store encrypted token via setToken()
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, type TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';

const THREADS_BASE = 'https://graph.threads.net';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, state, error } = req.query;
  const { returnTo: earlyReturnTo } = decodeOAuthState(state as string);
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';

  if (error) return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  if (!code) return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);

  try {
    const { companyId, userId: stateUserId, returnTo } = decodeOAuthState(state as string);

    const oauthCredentials = await getOAuthCredentialsForPlatform('threads');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Threads OAuth not configured — ask your Super Admin to add credentials.')}`);
    }

    const redirectUri = `${getBaseUrl(req)}/api/auth/threads/callback`;

    // ── Step 1: code → short-lived token ─────────────────────────────────
    const shortRes = await fetch(`${THREADS_BASE}/oauth/access_token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
        code:          code as string,
      }),
    });

    if (!shortRes.ok) {
      const e = await shortRes.json().catch(() => ({}));
      throw new Error(e?.error_message ?? `Token exchange failed (${shortRes.status})`);
    }

    const { access_token: shortToken } = await shortRes.json();

    // ── Step 2: short-lived → long-lived (60 days) ────────────────────────
    const longParams = new URLSearchParams({
      grant_type:        'th_exchange_token',
      client_secret:     oauthCredentials.client_secret,
      access_token:      shortToken,
    });

    const longRes = await fetch(`${THREADS_BASE}/access_token?${longParams}`);
    if (!longRes.ok) {
      const e = await longRes.json().catch(() => ({}));
      throw new Error(e?.error?.message ?? `Long-lived token exchange failed (${longRes.status})`);
    }

    const longData = await longRes.json();
    const accessToken = longData.access_token;
    const expiresIn   = longData.expires_in ?? 5184000; // 60 days default
    const expiresAt   = new Date(Date.now() + expiresIn * 1000).toISOString();

    // ── Step 3: fetch profile ─────────────────────────────────────────────
    const profileRes = await fetch(
      `${THREADS_BASE}/v1.0/me?fields=id,username,threads_profile_audience_size&access_token=${accessToken}`,
    );
    const profile = await profileRes.json().catch(() => ({}));

    if (!profile?.id) throw new Error('Failed to fetch Threads profile');

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || '';

    const tokenObj: TokenObject = {
      access_token: accessToken,
      expires_at:   expiresAt,
      token_type:   'Bearer',
    };
    const encryptedCols = encryptTokenColumns(tokenObj);
    const accountName   = profile.username ? `@${profile.username}` : profile.id;

    // ── Step 4: upsert social_account ────────────────────────────────────
    const { data: existing } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('platform', 'threads')
      .eq('platform_user_id', profile.id)
      .eq('user_id', userId)
      .single();

    let accountId: string;

    if (existing) {
      accountId = existing.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name:     accountName,
          is_active:        true,
          token_expires_at: expiresAt,
          last_sync_at:     new Date().toISOString(),
          updated_at:       new Date().toISOString(),
        })
        .eq('id', accountId);
    } else {
      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id:          userId,
          company_id:       companyId ?? null,
          platform:         'threads',
          platform_user_id: profile.id,
          account_name:     accountName,
          is_active:        true,
          token_expires_at: expiresAt,
          last_sync_at:     new Date().toISOString(),
          access_token:     encryptedCols.access_token,
          refresh_token:    encryptedCols.refresh_token ?? null,
        })
        .select('id')
        .single();

      if (insertError || !newAccount) throw new Error('Failed to create Threads account');
      accountId = newAccount.id;
    }

    await setToken(accountId, tokenObj);

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId)
        .catch((e) => console.warn('[threads/callback] setup credits failed:', e?.message));
    }

    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=threads&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (err: any) {
    console.error('[threads/callback] error:', err);
    return res.redirect(`${errDest}?error=${encodeURIComponent(err?.message ?? 'Threads connection failed')}`);
  }
}
