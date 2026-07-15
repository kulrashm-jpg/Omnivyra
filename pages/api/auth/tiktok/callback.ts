import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { logOAuthEvent, safeHost } from '../../../../backend/auth/oauthTelemetry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const decoded = decodeOAuthState(state as string);
  const { returnTo: earlyReturnTo } = decoded;
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';
  const callbackHost = safeHost(`${getBaseUrl(req)}/api/auth/tiktok/callback`);

  console.log('TikTok callback received:', { code: !!code, state, error, error_description });

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'tiktok',
    callback_host: callbackHost,
    company_id: decoded.companyId ?? null,
    state_user_id: decoded.userId ?? null,
    state_valid: decoded.valid === true,
    state_flow: decoded.flow ?? null,
    request_origin: (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null,
  });

  if (error) {
    console.error('TikTok OAuth error:', error, error_description);
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'tiktok',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'provider_error',
      failure_detail: String(error),
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    console.error('No authorization code received');
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'tiktok',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'missing_code',
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'tiktok';
    const { companyId, userId: stateUserId, returnTo, valid } = decodeOAuthState(state as string);
    if (!valid) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'tiktok',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'invalid_oauth_state',
        failure_detail: decoded.reason ?? 'state signature invalid',
      });
      return res.status(401).json({ error: 'invalid_oauth_state' });
    }

    const oauthCredentials = await getOAuthCredentialsForPlatform('tiktok');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('TikTok OAuth not configured — ask your Super Admin to add credentials.')}`);
    }

    // Exchange code for access token
    console.log('Exchanging code for token...');
    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${getBaseUrl(req)}/api/auth/tiktok/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'tiktok',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'token_exchange_failed',
        failure_detail: `HTTP ${tokenResponse.status}`,
      });
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.data?.access_token, expires_in: tokenData.data?.expires_in });

    // Get TikTok user info
    console.log('Fetching TikTok user info...');
    const userResponse = await fetch('https://open.tiktokapis.com/v2/user/info/', {
      headers: {
        Authorization: `Bearer ${tokenData.data.access_token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ fields: ['open_id', 'union_id', 'avatar_url', 'display_name', 'username'] }),
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info fetch failed:', userResponse.status, errorText);
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'tiktok',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: `user info HTTP ${userResponse.status}`,
      });
      throw new Error(`User info fetch failed: ${userResponse.statusText}`);
    }

    const userData = await userResponse.json();
    const userInfo = userData.data?.user || {};
    console.log('User info received:', { open_id: userInfo.open_id, username: userInfo.username });

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = userInfo.display_name || userInfo.username || 'TikTok User';
    const expiresIn = tokenData.data?.expires_in || 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const tokenObj: TokenObject = {
      access_token: tokenData.data.access_token,
      refresh_token: tokenData.data.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.data.token_type || 'Bearer',
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
        .eq('platform', 'tiktok')
        .eq('platform_user_id', userInfo.open_id || userInfo.union_id)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: userInfo.username || null,
          profile_picture_url: userInfo.avatar_url || null,
          is_active: true,
          // `permissions` removed — column not on social_accounts (schema drift).
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(companyIdUuid ? { company_id: companyIdUuid } : {}),
        })
        .eq('id', accountId);

      if (updateError) {
        console.error('Failed to update account:', updateError);
        throw new Error('Failed to update account');
      }
    } else {
      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert({
          user_id: userId,
          company_id: companyIdUuid,
          platform: 'tiktok',
          platform_user_id: userInfo.open_id || userInfo.union_id,
          account_name: accountName,
          username: userInfo.username || null,
          profile_picture_url: userInfo.avatar_url || null,
          is_active: true,
          // `permissions` removed — column not on social_accounts (schema drift).
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          access_token: encryptedCols.access_token,
          refresh_token: encryptedCols.refresh_token,
        })
        .select('id')
        .single();

      if (insertError || !newAccount) {
        console.error('Failed to create account:', insertError);
        logOAuthEvent({
          event: 'oauth_failure',
          provider: 'tiktok',
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

    console.log('✅ TikTok account saved successfully:', { accountId, accountName });

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId)
        .catch(e => console.warn('[tiktok/callback] setup credits check failed:', e?.message));
    }

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'tiktok',
      callback_host: callbackHost,
      company_id: companyId ?? null,
      user_id: userId,
      state_user_id: stateUserId ?? null,
    });
    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('TikTok OAuth callback error:', error);
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'tiktok',
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
export default __createApiRoute(handler, { route: '/api/auth/tiktok/callback' });
