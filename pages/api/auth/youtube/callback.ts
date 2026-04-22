import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { saveToken as saveCommunityAiToken } from '../../../../backend/services/platformTokenService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const earlyState = decodeOAuthState(state as string);
  const { returnTo: earlyReturnTo, flow: earlyFlow } = earlyState;
  const errDest = earlyFlow === 'community-ai'
    ? ((earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/community-ai/connectors')
    : ((earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms');

  if (error) {
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'youtube';
    const { companyId, userId: stateUserId, returnTo, valid } = decodeOAuthState(state as string);
    if (valid === false) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Invalid OAuth state')}`);
    }

    const credentials = await getOAuthCredentialsForPlatform(platform);
    if (!credentials?.client_id || !credentials?.client_secret) {
      return res.redirect(
        `${errDest}?error=${encodeURIComponent('YouTube OAuth not configured — ask your Super Admin to add credentials.')}`
      );
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/youtube/callback`,
        grant_type: 'authorization_code',
        code: code as string,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    
    // Get YouTube channel info
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      }
    });

    if (!channelResponse.ok) {
      throw new Error('Channel info fetch failed');
    }

    const channelData = await channelResponse.json();
    const channel = channelData.items?.[0];

    if (!channel?.id) {
      throw new Error('Failed to get YouTube channel info');
    }

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = channel.snippet?.title || 'YouTube Channel';
    const expiresIn = tokenData.expires_in || 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const grantedScopes = String(tokenData.scope || '')
      .split(/\s+/)
      .map((scope: string) => scope.trim())
      .filter(Boolean);

    // Prepare token object
    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: 'Bearer',
      scope: grantedScopes.join(' '),
    };
    const encryptedCols = encryptTokenColumns(tokenObj);

    // Create or update social account
    const companyIdUuid = companyId && /^[0-9a-f-]{36}$/i.test(companyId) ? companyId : null;
    let existingAccount: { id: string } | null = null;
    if (companyIdUuid) {
      const { data: tenantRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', companyIdUuid)
        .eq('platform', 'youtube')
        .eq('platform_user_id', channel.id)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }
    if (!existingAccount) {
      const { data: legacyRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .is('company_id', null)
        .eq('platform', 'youtube')
        .eq('platform_user_id', channel.id)
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
          username: channel.snippet?.customUrl || null,
          profile_picture_url: channel.snippet?.thumbnails?.default?.url || null,
          is_active: true,
          permissions: grantedScopes.length > 0 ? grantedScopes : [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.force-ssl',
          ],
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
          platform: 'youtube',
          platform_user_id: channel.id,
          account_name: accountName,
          username: channel.snippet?.customUrl || null,
          profile_picture_url: channel.snippet?.thumbnails?.default?.url || null,
          is_active: true,
          permissions: grantedScopes.length > 0 ? grantedScopes : [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/youtube',
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.force-ssl',
          ],
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

    // Save encrypted tokens
    await setToken(accountId, tokenObj);

    console.log('✅ YouTube account saved successfully:', { accountId, accountName });

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId)
        .catch(e => console.warn('[youtube/callback] setup credits check failed:', e?.message));
    }

    const { flow: stateFlow, tenantId: stateTenantId } = decodeOAuthState(state as string);
    if (stateFlow === 'community-ai' && stateTenantId) {
      await saveCommunityAiToken(stateTenantId, stateTenantId, 'youtube', {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        connected_by_user_id: userId,
      });
      const communityDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/community-ai/connectors';
      return res.redirect(`${communityDest}?connected=youtube&status=success`);
    }

    const successDest = returnTo || '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=${platform}&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('YouTube OAuth callback error:', error);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}
