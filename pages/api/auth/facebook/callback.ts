import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { syncInstagramAndThreadsFromMeta } from '../../../../backend/services/metaDerivedAccountsService';
import { persistGrantedScopes, normaliseScopes } from '../../../../backend/auth/oauthScopePersistence';
import { logOAuthEvent, safeHost } from '../../../../backend/auth/oauthTelemetry';
import { config } from '@/config';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const decoded = decodeOAuthState(state as string);
  const { returnTo: earlyReturnTo } = decoded;
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';
  const callbackHost = safeHost(`${getBaseUrl(req)}/api/auth/facebook/callback`);

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'facebook',
    callback_host: callbackHost,
    company_id: decoded.companyId ?? null,
    state_user_id: decoded.userId ?? null,
    state_valid: decoded.valid === true,
    state_flow: decoded.flow ?? null,
    request_origin: (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null,
  });

  if (error) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'facebook',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'provider_error',
      failure_detail: String(error),
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'facebook',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'missing_code',
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'facebook';
    const { companyId, userId: stateUserId, returnTo, valid } = decodeOAuthState(state as string);
    if (!valid) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'facebook',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'invalid_oauth_state',
        failure_detail: decoded.reason ?? 'state signature invalid',
      });
      return res.status(401).json({ error: 'invalid_oauth_state' });
    }

    const oauthCredentials = await getOAuthCredentialsForPlatform('facebook');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Facebook OAuth not configured — ask your Super Admin to add credentials.')}`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://graph.facebook.com/v22.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/facebook/callback`,
        code: code as string,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.json().catch(() => ({}));
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'facebook',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'token_exchange_failed',
        failure_detail: `HTTP ${tokenResponse.status}`,
      });
      throw new Error(err?.error?.message ?? 'Token exchange failed');
    }

    const tokenData = await tokenResponse.json();

    // Exchange short-lived token for long-lived (60 days)
    const longLivedResponse = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        fb_exchange_token: tokenData.access_token,
      })
    );

    const longLivedData = longLivedResponse.ok
      ? await longLivedResponse.json()
      : tokenData;

    const accessToken = longLivedData.access_token ?? tokenData.access_token;
    const expiresIn = longLivedData.expires_in ?? tokenData.expires_in ?? 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Get Facebook user profile
    const profileResponse = await fetch(
      `https://graph.facebook.com/v22.0/me?fields=id,name&access_token=${accessToken}`
    );
    const profile = await profileResponse.json();

    if (!profile?.id) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'facebook',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: 'profile.id missing from /me response',
      });
      throw new Error('Failed to fetch Facebook profile');
    }

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || config.DEFAULT_USER_ID || '';

    if (!userId) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = profile.name || 'Facebook Account';

    const tokenObj: TokenObject = {
      access_token: accessToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
    };
    const encryptedCols = encryptTokenColumns(tokenObj);

    const companyIdUuid = companyId && /^[0-9a-f-]{36}$/i.test(companyId) ? companyId : null;
    let existingAccount: { id: string } | null = null;
    if (companyIdUuid) {
      const { data: tenantRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', companyIdUuid)
        .eq('platform', 'facebook')
        .eq('platform_user_id', profile.id)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          is_active: true,
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(companyIdUuid ? { company_id: companyIdUuid } : {}),
        })
        .eq('id', accountId);
    } else {
      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id: userId,
          company_id: companyIdUuid,
          platform: 'facebook',
          platform_user_id: profile.id,
          account_name: accountName,
          is_active: true,
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          access_token: encryptedCols.access_token,
          refresh_token: encryptedCols.refresh_token,
        })
        .select('id')
        .single();

      if (insertError || !newAccount) {
        logOAuthEvent({
          event: 'oauth_failure',
          provider: 'facebook',
          callback_host: callbackHost,
          company_id: companyId ?? null,
          user_id: userId,
          state_user_id: stateUserId ?? null,
          failure_point: 'persistence_failed',
          failure_detail: insertError?.message?.slice(0, 200) ?? 'social_accounts insert failed',
        });
        throw new Error('Failed to create account');
      }

      accountId = newAccount.id;
    }

    await setToken(accountId, tokenObj);

    // Phase 0 — persist actually-granted scopes. Meta returns `scope` as a
    // comma-separated string on token-exchange responses.
    const grantedFacebookScopes = normaliseScopes(
      longLivedData.scope ?? tokenData.scope,
      'comma',
    );
    await persistGrantedScopes({
      socialAccountId: accountId,
      platform: 'facebook',
      grantedScopes: grantedFacebookScopes,
    });

    let derivedThreadsCount = 0;
    try {
      const syncResult = await syncInstagramAndThreadsFromMeta({
        userId,
        companyId: companyId || null,
        accessToken,
        expiresAt,
        permissions: String(tokenData.scope || longLivedData.scope || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      derivedThreadsCount = syncResult.threadsAccounts.length;
      if (syncResult.instagramAccounts.length > 0) {
        console.log('Instagram/Threads derived accounts synced from Facebook:', syncResult);
      }
    } catch (syncError: any) {
      console.warn('[facebook/callback] Instagram/Threads derivation skipped:', syncError?.message);
    }

    console.log('✅ Facebook account saved successfully:', { accountId, accountName });

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId)
        .catch(e => console.warn('[facebook/callback] setup credits check failed:', e?.message));
    }

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'facebook',
      callback_host: callbackHost,
      company_id: companyId ?? null,
      user_id: userId,
      state_user_id: stateUserId ?? null,
    });
    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=${platform}&threads=${derivedThreadsCount > 0 ? 'enabled' : 'disabled'}&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('Facebook OAuth callback error:', error);
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'facebook',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'callback_exception',
      failure_detail: String(error?.message ?? error).slice(0, 200),
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/facebook/callback' });
