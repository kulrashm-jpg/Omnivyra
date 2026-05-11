import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { saveToken as saveCommunityAiToken } from '../../../../backend/services/platformTokenService';

function getRequestBaseUrl(req: NextApiRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string) || 'localhost:3000';
  return `${proto}://${host}`.replace('://localhost:', '://127.0.0.1:');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const { returnTo: returnToEarly, flow: earlyFlow } = decodeOAuthState(state as string);
  const errDest = earlyFlow === 'community-ai'
    ? ((returnToEarly && returnToEarly.startsWith('/')) ? returnToEarly : '/community-ai/connectors')
    : ((returnToEarly && returnToEarly.startsWith('/')) ? returnToEarly : '/social-platforms');

  if (error) {
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'x';
    const { valid } = decodeOAuthState(state as string);
    if (valid === false) {
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
    const userId = sessionUser?.id || stateUserId || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required - please log in and try again')}`);
    }

    if (!userProfile.data?.id) {
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
        throw new Error('Failed to create account');
      }

      accountId = newAccount.id;
    }

    await setToken(accountId, tokenObj);

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
      const communityDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/community-ai/connectors';
      return res.redirect(`${communityDest}?connected=${platform}&status=success`);
    }

    const successDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/social-platforms';
    const separator = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${separator}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);
  } catch (error: any) {
    console.error('X OAuth callback error:', error);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}
