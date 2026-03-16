import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const { returnTo: earlyReturnTo } = decodeOAuthState(state as string);
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';

  if (error) {
    const desc = error_description ? ` — ${error_description}` : '';
    console.error('[LinkedIn callback] OAuth error from LinkedIn:', error, error_description);
    return res.redirect(`${errDest}?error=${encodeURIComponent(`LinkedIn error: ${error}${desc}`)}`);
  }

  if (!code) {
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'linkedin';
    const { companyId, userId: stateUserId, returnTo } = decodeOAuthState(state as string);

    const credentials = await getOAuthCredentialsForPlatform(platform);
    if (!credentials?.client_id || !credentials?.client_secret) {
      return res.redirect(
        `${errDest}?error=${encodeURIComponent('LinkedIn OAuth not configured — ask your Super Admin to add credentials.')}`
      );
    }

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/linkedin/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[LinkedIn callback] Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed (${tokenResponse.status}): ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('[LinkedIn callback] token received:', { access_token: !!tokenData.access_token, expires_in: tokenData.expires_in });

    // Fetch profile — try /v2/userinfo (OIDC) first, fall back to /v2/me
    let profile: Record<string, any> = {};
    const userinfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userinfoRes.ok) {
      profile = await userinfoRes.json();
      // OIDC shape: { sub, name, given_name, family_name, email, picture }
    } else {
      // Old API shape: { id, firstName: { localized: { en_US } }, lastName: ... }
      const meRes = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      if (!meRes.ok) {
        const errorText = await meRes.text();
        console.error('[LinkedIn callback] Profile fetch failed:', meRes.status, errorText);
        throw new Error(`Profile fetch failed: ${meRes.statusText}`);
      }
      const me = await meRes.json();
      // Normalise to flat shape
      profile = {
        sub: me.id,
        name: `${me.firstName?.localized?.en_US || ''} ${me.lastName?.localized?.en_US || ''}`.trim(),
        given_name: me.firstName?.localized?.en_US || null,
      };
    }
    console.log('[LinkedIn callback] profile received:', { sub: profile.sub, name: profile.name });

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = profile.name || `${profile.given_name || 'LinkedIn'} ${profile.family_name || 'User'}`;
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Prepare token object for encrypted storage
    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.token_type || 'Bearer',
    };

    // OIDC: user identifier is profile.sub
    const platformUserId = profile.sub || profile.id;
    if (!platformUserId) throw new Error('Could not get LinkedIn user ID from profile');

    const companyIdUuid = companyId && /^[0-9a-f-]{36}$/i.test(companyId) ? companyId : null;
    // Prefer tenant-scoped row; fall back to legacy (company_id null)
    let existingAccount: { id: string } | null = null;
    if (companyIdUuid) {
      const { data: tenantRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('company_id', companyIdUuid)
        .eq('platform', 'linkedin')
        .eq('platform_user_id', platformUserId)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }
    if (!existingAccount) {
      const { data: legacyRow } = await supabase
        .from('social_accounts')
        .select('id')
        .eq('user_id', userId)
        .is('company_id', null)
        .eq('platform', 'linkedin')
        .eq('platform_user_id', platformUserId)
        .maybeSingle();
      existingAccount = legacyRow;
    }

    let accountId: string;

    const updatePayload: Record<string, unknown> = {
      account_name: accountName,
      username: profile.given_name || null,
      is_active: true,
      permissions: tokenData.scope?.split(' ') || [],
      token_expires_at: expiresAt,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (companyIdUuid) updatePayload.company_id = companyIdUuid;

    if (existingAccount) {
      // Update existing account
      accountId = existingAccount.id;
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update(updatePayload)
        .eq('id', accountId);

      if (updateError) {
        console.error('Failed to update account:', updateError);
        throw new Error('Failed to update account');
      }
    } else {
      // Create new account
      let encryptedCols: { access_token: string; refresh_token: string | null };
      try {
        encryptedCols = encryptTokenColumns(tokenObj);
      } catch (encErr: any) {
        console.error('[LinkedIn callback] encryptTokenColumns failed:', encErr.message);
        throw new Error(`Token encryption failed: ${encErr.message}`);
      }

      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        platform: 'linkedin',
        platform_user_id: platformUserId,
        account_name: accountName,
        username: profile.given_name || null,
        is_active: true,
        permissions: tokenData.scope?.split(' ') || [],
        token_expires_at: expiresAt,
        last_sync_at: new Date().toISOString(),
        access_token: encryptedCols.access_token,
        refresh_token: encryptedCols.refresh_token,
      };
      if (companyIdUuid) insertPayload.company_id = companyIdUuid;

      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError || !newAccount) {
        console.error('[LinkedIn callback] Failed to create account:', insertError);
        throw new Error(`Failed to create account: ${insertError?.message || insertError?.code || 'unknown DB error'}`);
      }

      accountId = newAccount.id;
    }

    // Save encrypted tokens using tokenStore
    await setToken(accountId, tokenObj);

    console.log('✅ LinkedIn account saved successfully:', { accountId, accountName });

    const successDest = returnTo || '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=linkedin&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('LinkedIn OAuth callback error:', error);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}
