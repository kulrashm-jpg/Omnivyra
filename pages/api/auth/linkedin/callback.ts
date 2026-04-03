import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { saveToken as saveCommunityAiToken } from '../../../../backend/services/platformTokenService';

/** Derives base URL from the actual request host — never the NEXT_PUBLIC_APP_URL env var.
 *  This ensures the redirect_uri used in token exchange exactly matches what was sent
 *  in the authorization request, even when NEXT_PUBLIC_APP_URL points to production. */
function getRequestBaseUrl(req: NextApiRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string) || 'localhost:3000';
  return `${proto}://${host}`;
}

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
        redirect_uri: `${getRequestBaseUrl(req)}/api/auth/linkedin/callback`,
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
    let linkedinConnectionCount = 0;

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

    // Attempt to fetch connection/follower count via /v2/me projection.
    // Works for standard LinkedIn developer apps — no partner approval required.
    // LinkedIn may return numConnections (exact) or numConnectionsRange (bucketed) depending on app permissions.
    try {
      const meProjectionRes = await fetch(
        'https://api.linkedin.com/v2/me?projection=(id,numConnections,numConnectionsRange)',
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );
      if (meProjectionRes.ok) {
        const meData = await meProjectionRes.json();
        console.log('[LinkedIn callback] /v2/me projection response:', JSON.stringify(meData));
        if (typeof meData.numConnections === 'number' && meData.numConnections > 0) {
          linkedinConnectionCount = meData.numConnections;
        } else if (meData.numConnectionsRange) {
          // LinkedIn returns a range when count exceeds 500 (e.g. { start: 500, end: 999 })
          linkedinConnectionCount = meData.numConnectionsRange.end ?? meData.numConnectionsRange.start ?? 0;
        }
        console.log('[LinkedIn callback] connection count:', linkedinConnectionCount);
      } else {
        const errText = await meProjectionRes.text();
        console.log('[LinkedIn callback] /v2/me projection returned', meProjectionRes.status, errText);
      }
    } catch (connErr) {
      console.log('[LinkedIn callback] Could not fetch connection count:', connErr);
    }

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
    if (linkedinConnectionCount > 0) updatePayload.follower_count = linkedinConnectionCount;
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
        ...(linkedinConnectionCount > 0 && { follower_count: linkedinConnectionCount }),
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

    // NOTE: LinkedIn connection count (r_network scope) requires LinkedIn Partner Program
    // approval and cannot be fetched with standard OAuth scopes. Connection count will
    // not be stored here; the UI handles missing counts gracefully.

    console.log('✅ LinkedIn account saved successfully:', { accountId, accountName });

    if (companyIdUuid && userId) {
      checkAndGrantSetupCredits(companyIdUuid, userId)
        .catch(e => console.warn('[linkedin/callback] setup credits check failed:', e?.message));
    }

    // If this request came from the Community AI connector flow, also save to
    // community_ai_platform_tokens and redirect back to the connectors page.
    const { flow: stateFlow, tenantId: stateTenantId } = decodeOAuthState(state as string);
    if (stateFlow === 'community-ai' && stateTenantId) {
      await saveCommunityAiToken(stateTenantId, stateTenantId, 'linkedin', {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt,
        connected_by_user_id: userId,
      });
      console.info('[connector_audit]', JSON.stringify({ user_id: userId, company_id: stateTenantId, platform: 'linkedin', action: 'connect' }));
      const communityDest = (returnTo && returnTo.startsWith('/')) ? returnTo : '/community-ai/connectors';
      return res.redirect(`${communityDest}?connected=linkedin&status=success`);
    }

    const successDest = returnTo || '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    return res.redirect(`${successDest}${sep}connected=linkedin&account=${encodeURIComponent(accountName)}&success=true`);

  } catch (error: any) {
    console.error('LinkedIn OAuth callback error:', error);
    return res.redirect(`${errDest}?error=${encodeURIComponent(error.message || 'Connection failed')}`);
  }
}
