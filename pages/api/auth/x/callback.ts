import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { saveToken as saveCommunityAiToken } from '../../../../backend/services/platformTokenService';
import { persistGrantedScopes, normaliseScopes } from '../../../../backend/auth/oauthScopePersistence';
import { logOAuthEvent, safeHost } from '../../../../backend/auth/oauthTelemetry';
import { config } from '@/config';

function getRequestBaseUrl(req: NextApiRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string) || 'localhost:3000';
  return `${proto}://${host}`.replace('://localhost:', '://127.0.0.1:');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const decoded = decodeOAuthState(state as string);
  const { returnTo: returnToEarly, flow: earlyFlow } = decoded;
  const errDest = earlyFlow === 'community-ai'
    ? ((returnToEarly && returnToEarly.startsWith('/')) ? returnToEarly : '/community-ai/connectors')
    : ((returnToEarly && returnToEarly.startsWith('/')) ? returnToEarly : '/social-platforms');
  const callbackHost = safeHost(`${getRequestBaseUrl(req)}/auth/x/callback`);

  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: 'x',
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
      provider: 'x',
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
      provider: 'x',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: 'missing_code',
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'x';
    const { valid } = decodeOAuthState(state as string);
    if (valid === false) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'x',
        callback_host: callbackHost,
        company_id: decoded.companyId ?? null,
        state_user_id: decoded.userId ?? null,
        failure_point: 'invalid_oauth_state',
        failure_detail: decoded.reason ?? 'state signature invalid',
      });
      return res.redirect(`${errDest}?error=${encodeURIComponent('Invalid OAuth state')}`);
    }
    const oauthCredentials = await getOAuthCredentialsForPlatform(platform);
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('X OAuth not configured - ask your Super Admin to add credentials.')}`);
    }

    const credentials = Buffer.from(
      `${oauthCredentials.client_id}:${oauthCredentials.client_secret}`
    ).toString('base64');

    const { codeVerifier: earlyCodeVerifier } = decodeOAuthState(state as string);

    const tokenResponse = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: `${getRequestBaseUrl(req)}/auth/x/callback`,
        code_verifier: earlyCodeVerifier || '',
        client_id: oauthCredentials.client_id,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    const tokenData = tokenResponse.data;

    const profileResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      params: {
        'user.fields': 'username,profile_image_url',
      },
    });

    const userProfile = { data: profileResponse.data.data };
    const { companyId, userId: stateUserId, returnTo, flow: stateFlow, tenantId: stateTenantId } = decodeOAuthState(state as string);

    const { user: sessionUser } = await getSupabaseUserFromRequest(req);
    const userId = sessionUser?.id || stateUserId || config.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required - please log in and try again')}`);
    }

    if (!userProfile.data?.id) {
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'x',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        user_id: userId,
        state_user_id: stateUserId ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: 'users/me response missing data.id',
      });
      throw new Error('Failed to get user profile');
    }

    const accountName = `@${userProfile.data?.username || userProfile.data?.id}`;
    const expiresIn = tokenData.expires_in || 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
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
        .eq('platform', platform)
        .eq('platform_user_id', userProfile.data.id)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }
    if (!existingAccount) {
      const { data: legacyRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .is('company_id', null)
        .eq('platform', platform)
        .eq('platform_user_id', userProfile.data.id)
        .maybeSingle();
      existingAccount = legacyRow;
    }

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          username: userProfile.data.username || null,
          is_active: true,
          // `permissions` removed — column not on social_accounts (schema drift).
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
          platform,
          platform_user_id: userProfile.data.id,
          account_name: accountName,
          username: userProfile.data.username || null,
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
        logOAuthEvent({
          event: 'oauth_failure',
          provider: 'x',
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

    // Phase 0 — persist actually-granted scopes (X OAuth 2.0 returns the
    // granted scope set as a space-separated `scope` field on the token
    // response). Fall back to the originally-requested scopes if absent.
    const requestedXScopes = 'tweet.read tweet.write media.write users.read like.write follows.write offline.access';
    const grantedXScopes = normaliseScopes(tokenData.scope ?? requestedXScopes, 'space');
    await persistGrantedScopes({
      socialAccountId: accountId,
      platform: 'x',
      grantedScopes: grantedXScopes,
    });

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId)
        .catch((saveError) => console.warn('[x/callback] setup credits check failed:', saveError?.message));
    }

    if (stateFlow === 'community-ai' && stateTenantId) {
      await saveCommunityAiToken(stateTenantId, stateTenantId, platform, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        connected_by_user_id: userId,
      });
      console.info('[connector_audit]', JSON.stringify({ user_id: userId, company_id: stateTenantId, platform, action: 'connect' }));
      logOAuthEvent({
        event: 'oauth_success',
        provider: 'x',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        user_id: userId,
        state_user_id: stateUserId ?? null,
        state_flow: 'community-ai',
      });
      const communityDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/community-ai/connectors';
      return res.redirect(`${communityDest}?connected=${platform}&status=success`);
    }

    logOAuthEvent({
      event: 'oauth_success',
      provider: 'x',
      callback_host: callbackHost,
      company_id: companyId ?? null,
      user_id: userId,
      state_user_id: stateUserId ?? null,
    });
    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const separator = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${separator}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);
  } catch (error: any) {
    console.error('X OAuth callback error:', error);
    // X uses axios for token exchange and profile fetch; axios throws on non-2xx.
    // We classify network/axios failures as token_exchange_failed when the URL
    // matches the token endpoint, otherwise as a generic callback_exception.
    const errMsg = String(error?.message ?? error);
    const isAxiosTokenErr = error?.config?.url?.includes('/oauth2/token') === true;
    logOAuthEvent({
      event: 'oauth_failure',
      provider: 'x',
      callback_host: callbackHost,
      company_id: decoded.companyId ?? null,
      state_user_id: decoded.userId ?? null,
      failure_point: isAxiosTokenErr ? 'token_exchange_failed' : 'callback_exception',
      failure_detail: errMsg.slice(0, 200),
    });
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/x/callback' });
