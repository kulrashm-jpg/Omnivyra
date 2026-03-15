import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

function parseState(state: string | undefined): { companyId?: string; returnTo?: string } {
  if (!state || typeof state !== 'string') return {};
  const [stateBase, returnTo] = state.split('|');
  const result: { companyId?: string; returnTo?: string } = {};
  if (returnTo && returnTo.startsWith('/')) result.returnTo = returnTo;
  if (stateBase.startsWith('c:')) {
    const parts = stateBase.split(':');
    if (parts.length >= 2) result.companyId = parts[1];
  }
  return result;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error, error_description } = req.query;
  const { returnTo: earlyReturnTo } = parseState(state as string);
  const errDest = (earlyReturnTo && earlyReturnTo.startsWith('/')) ? earlyReturnTo : '/social-platforms';

  if (error) {
    console.error('LinkedIn OAuth error:', error, error_description);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);
  }

  try {
    const platform = 'linkedin';
    const { companyId, returnTo } = parseState(state as string);

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
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/linkedin/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token received:', { access_token: !!tokenData.access_token, expires_in: tokenData.expires_in });
    
    // Get LinkedIn profile info
    console.log('Fetching LinkedIn profile...');
    const profileResponse = await fetch('https://api.linkedin.com/v2/people/~:(id,firstName,lastName,profilePicture(displayImage~:playableStreams))', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      console.error('Profile fetch failed:', profileResponse.status, errorText);
      throw new Error(`Profile fetch failed: ${profileResponse.statusText}`);
    }

    const profile = await profileResponse.json();
    console.log('Profile received:', { id: profile.id, firstName: profile.firstName });

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || process.env.DEFAULT_USER_ID || '';

    if (!userId) {
      console.error('No user_id available - cannot save account');
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }

    const accountName = `${profile.firstName?.localized?.en_US || 'LinkedIn'} ${profile.lastName?.localized?.en_US || 'User'}`;
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Prepare token object for encrypted storage
    const tokenObj: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expires_at: expiresAt,
      token_type: tokenData.token_type || 'Bearer',
    };

    // Create or update social account in database (G2.2: always set company_id from validated context)
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
        .eq('platform_user_id', profile.id)
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
        .eq('platform_user_id', profile.id)
        .maybeSingle();
      existingAccount = legacyRow;
    }

    let accountId: string;

    const updatePayload: Record<string, unknown> = {
      account_name: accountName,
      username: profile.firstName?.localized?.en_US || null,
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
      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        platform: 'linkedin',
        platform_user_id: profile.id,
        account_name: accountName,
        username: profile.firstName?.localized?.en_US || null,
        is_active: true,
        permissions: tokenData.scope?.split(' ') || [],
        token_expires_at: expiresAt,
        last_sync_at: new Date().toISOString(),
      };
      if (companyIdUuid) insertPayload.company_id = companyIdUuid;

      const { data: newAccount, error: insertError } = await supabase
        .from('social_accounts')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError || !newAccount) {
        console.error('Failed to create account:', insertError);
        throw new Error('Failed to create account');
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
