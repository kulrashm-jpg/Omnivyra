import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { logOAuthEvent, safeHost } from '../../../../backend/auth/oauthTelemetry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const decoded = decodeOAuthState(state as string);
  const { returnTo: earlyReturnTo } = decoded;
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';
  const callbackHost = safeHost(`${getBaseUrl(req)}/api/auth/spotify/callback`);

  console.log('Spotify callback received:', { code: !!code, state, error, error_description });

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'spotify',
    callback_host: callbackHost,
    company_id: decoded.companyId ?? null,
    state_user_id: decoded.userId ?? null,
    state_valid: decoded.valid === true,
    state_flow: decoded.flow ?? null,
    request_origin: (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null,
  });

  if (error) {
    console.error('Spotify OAuth error:', error, error_description);
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'spotify',
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
      provider: 'spotify',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'missing_code',
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'spotify';
    const { companyId, userId: stateUserId, returnTo, valid } = decodeOAuthState(state as string);
    if (!valid) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'spotify',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'invalid_oauth_state',
        failure_detail: decoded.reason ?? 'state signature invalid',
      });
      return res.status(401).json({ error: 'invalid_oauth_state' });
    }

    const oauthCredentials = await getOAuthCredentialsForPlatform('spotify');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Spotify OAuth not configured — ask your Super Admin to add credentials.')}`);
    }

    // Exchange code for access token
    console.log('Exchanging code for token...');
    const credentials = Buffer.from(
      `${oauthCredentials.client_id}:${oauthCredentials.client_secret}`
    ).toString('base64');

    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${getBaseUrl(req)}/api/auth/spotify/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'spotify',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'token_exchange_failed',
        failure_detail: `HTTP ${tokenResponse.status}`,
      });
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.access_token, expires_in: tokenData.expires_in });

    // Get Spotify user info
    console.log('Fetching Spotify user info...');
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info fetch failed:', userResponse.status, errorText);
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'spotify',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        state_user_id: stateUserId ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: `me HTTP ${userResponse.status}`,
      });
      throw new Error(`User info fetch failed: ${userResponse.statusText}`);
    }

    const userInfo = await userResponse.json();
    console.log('User info received:', { id: userInfo.id, display_name: userInfo.display_name });

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = userInfo.display_name || userInfo.id || 'Spotify User';
    const expiresIn = tokenData.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.token_type || 'Bearer',
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
        .eq('platform', 'spotify')
        .eq('platform_user_id', userInfo.id)
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
          username: userInfo.id || null,
          profile_picture_url: userInfo.images?.[0]?.url || null,
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
          platform: 'spotify',
          platform_user_id: userInfo.id,
          account_name: accountName,
          username: userInfo.id || null,
          profile_picture_url: userInfo.images?.[0]?.url || null,
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
          provider: 'spotify',
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

    console.log('✅ Spotify account saved successfully:', { accountId, accountName });

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'spotify',
      callback_host: callbackHost,
      company_id: companyId ?? null,
      user_id: userId,
      state_user_id: stateUserId ?? null,
    });
    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('Spotify OAuth callback error:', error);
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'spotify',
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
export default __createApiRoute(handler, { route: '/api/auth/spotify/callback' });
