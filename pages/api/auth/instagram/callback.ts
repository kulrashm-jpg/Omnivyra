import { NextApiRequest, NextApiResponse } from 'next';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { syncInstagramAndThreadsFromMeta } from '../../../../backend/services/metaDerivedAccountsService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { encryptTokenColumns, setToken } from '../../../../backend/auth/tokenStore';
import { persistGrantedScopesByPlatformUser, normaliseScopes } from '../../../../backend/auth/oauthScopePersistence';
import { config } from '@/config';

type MetaPageSummary = {
  id: string;
  name?: string | null;
};

type MetaPageInstagramResponse = {
  id?: string;
  name?: string | null;
  instagram_business_account?: { id?: string } | null;
};

type MetaInstagramValidationResponse = {
  id?: string;
  username?: string | null;
};

async function readMetaJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json().catch(() => ({
    error: {
      message: `Unable to parse Meta response (${response.status})`,
      status: response.status,
    },
  }));
}

async function fetchMetaJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Meta request failed (${response.status})`);
  }
  return body as T;
}

async function resolveInstagramBusinessPage(accessToken: string): Promise<{
  pageId: string;
  pageName: string;
  instagramId: string;
  instagramUsername: string | null;
}> {
  const pagesResponse = await fetchMetaJson<{ data?: MetaPageSummary[] }>(
    `https://graph.facebook.com/v22.0/me/accounts?access_token=${encodeURIComponent(accessToken)}`
  );
  const pages = Array.isArray(pagesResponse.data) ? pagesResponse.data : [];
  console.log('META PAGES COUNT', pages.length);

  if (pages.length === 0) {
    throw new Error('No Pages available');
  }

  const matches: Array<{ pageId: string; pageName: string; instagramId: string }> = [];
  for (const page of pages) {
    if (!page?.id) continue;
    const pageDetails = await fetchMetaJson<MetaPageInstagramResponse>(
      `https://graph.facebook.com/v22.0/${encodeURIComponent(page.id)}?` +
        new URLSearchParams({
          fields: 'name,instagram_business_account',
          access_token: accessToken,
        })
    );
    const instagramId = pageDetails.instagram_business_account?.id;
    if (typeof instagramId === 'string' && instagramId.trim()) {
      matches.push({
        pageId: page.id,
        pageName: pageDetails.name || page.name || 'Facebook Page',
        instagramId: instagramId.trim(),
      });
    }
  }

  if (matches.length === 0) {
    throw new Error('No Instagram Business Account found');
  }
  if (matches.length > 1) {
    console.warn('META MULTIPLE INSTAGRAM BUSINESS ACCOUNTS FOUND', matches);
  }

  const selected = matches[0];
  const validationResponse = await fetch(
    `https://graph.facebook.com/v22.0/${encodeURIComponent(selected.instagramId)}?` +
      new URLSearchParams({
        fields: 'id,username',
        access_token: accessToken,
      })
  );
  const validationBody = await validationResponse.json().catch(() => null) as MetaInstagramValidationResponse | null;
  if (!validationResponse.ok || validationBody?.id !== selected.instagramId) {
    throw new Error('Instagram account not accessible with current token');
  }

  const finalSelection = {
    ...selected,
    instagramUsername: validationBody.username ?? null,
  };
  console.log('META FINAL PAGE:', finalSelection.pageName);
  console.log('META FINAL PAGE ID:', finalSelection.pageId);
  console.log('META FINAL INSTAGRAM USERNAME:', finalSelection.instagramUsername);
  console.log('META FINAL INSTAGRAM ID:', finalSelection.instagramId);
  return finalSelection;
}

async function storeThreadsConnection(input: {
  userId: string;
  companyId: string | null;
  selectedPage: { pageId: string; pageName: string; instagramId: string; instagramUsername: string | null };
  accessToken: string;
  expiresAt: string;
  permissions: string[];
}): Promise<void> {
  const encrypted = encryptTokenColumns({
    access_token: input.accessToken,
    expires_at: input.expiresAt,
    token_type: 'Bearer',
    scope: input.permissions.join(','),
  });
  const now = new Date().toISOString();

  let existingQuery = supabase
    .from('social_accounts')
    .select('id')
    .eq('user_id', input.userId)
    .eq('platform', 'threads')
    .eq('platform_user_id', input.selectedPage.instagramId);
  existingQuery = input.companyId ? existingQuery.eq('company_id', input.companyId) : existingQuery.is('company_id', null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  const payload = {
    user_id: input.userId,
    company_id: input.companyId,
    platform: 'threads',
    platform_user_id: input.selectedPage.instagramId,
    account_name: `Threads via ${input.selectedPage.pageName}`,
    username: input.selectedPage.instagramUsername,
    access_token: encrypted.access_token,
    refresh_token: encrypted.refresh_token,
    is_active: true,
    // `permissions` removed — column not on social_accounts (schema drift).
    token_expires_at: input.expiresAt,
    last_sync_at: now,
    updated_at: now,
    business_account_id: input.selectedPage.pageId,
  };

  let accountId = existing?.id as string | undefined;
  if (accountId) {
    const { error } = await supabase
      .from('social_accounts')
      .update(payload)
      .eq('id', accountId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('social_accounts')
      .insert({ ...payload, created_at: now })
      .select('id')
      .single();
    if (error) throw error;
    accountId = data?.id;
  }

  if (accountId) {
    await setToken(accountId, {
      access_token: input.accessToken,
      expires_at: input.expiresAt,
      token_type: 'Bearer',
      scope: input.permissions.join(','),
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const { returnTo: earlyReturnTo } = decodeOAuthState(state as string);
  const errDest = earlyReturnTo && earlyReturnTo.startsWith('/') ? earlyReturnTo : '/social-platforms';

  if (error) return res.redirect(`${errDest}?error=${encodeURIComponent(error as string)}`);
  if (!code) return res.redirect(`${errDest}?error=${encodeURIComponent('No authorization code received')}`);

  try {
    const platform = 'instagram';
    const { companyId, userId: stateUserId, returnTo } = decodeOAuthState(state as string);

    const oauthCredentials = await getOAuthCredentialsForPlatform('instagram');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Instagram OAuth not configured - ask your Super Admin to add Meta credentials.')}`);
    }

    const tokenResponse = await fetch('https://graph.facebook.com/v22.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/instagram/callback`,
        code: code as string,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? 'Token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    const longLivedResponse = await fetch(
      `https://graph.facebook.com/v22.0/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: oauthCredentials.client_id,
          client_secret: oauthCredentials.client_secret,
          fb_exchange_token: tokenData.access_token,
        })
    );
    const longLivedData = longLivedResponse.ok ? await longLivedResponse.json() : tokenData;
    const accessToken = longLivedData.access_token ?? tokenData.access_token;

    if (config.META_DEBUG) {
      const accountsDebug = await readMetaJson(
        `https://graph.facebook.com/v22.0/me/accounts?access_token=${encodeURIComponent(accessToken)}`
      );
      console.log('META DEBUG /me/accounts:', JSON.stringify(accountsDebug, null, 2));

      const tokenDebug = await readMetaJson(
        `https://graph.facebook.com/v22.0/debug_token?` +
          new URLSearchParams({
            input_token: accessToken,
            access_token: `${oauthCredentials.client_id}|${oauthCredentials.client_secret}`,
          })
      );
      console.log('META DEBUG /debug_token:', JSON.stringify(tokenDebug, null, 2));
    }

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || config.DEFAULT_USER_ID || '';
    if (!userId) {
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required - please log in and try again')}`);
    }

    const expiresIn = longLivedData.expires_in || tokenData.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const permissions = String(tokenData.scope || longLivedData.scope || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const selectedPage = await resolveInstagramBusinessPage(accessToken);
    await storeThreadsConnection({
      userId,
      companyId: companyId || null,
      selectedPage,
      accessToken,
      expiresAt,
      permissions,
    });

    const syncResult = await syncInstagramAndThreadsFromMeta({
      userId,
      companyId: companyId || null,
      accessToken,
      expiresAt,
      permissions,
    });

    if (syncResult.instagramAccounts.length === 0) {
      throw new Error('No Instagram Business account found. Connect a Facebook Page with an Instagram Business account to enable Instagram and Threads.');
    }

    // Phase 0 — persist actually-granted scopes on every social_accounts row
    // produced from this Meta connection (Threads via Page + IG Business +
    // Threads-from-IG, if present). Meta scope is comma-separated.
    const grantedMetaScopes = normaliseScopes(
      String(tokenData.scope || longLivedData.scope || ''),
      'comma',
    );
    if (grantedMetaScopes.length > 0) {
      await persistGrantedScopesByPlatformUser({
        userId,
        companyId: companyId || null,
        platform: 'threads',
        platformUserId: selectedPage.instagramId,
        grantedScopes: grantedMetaScopes,
      });
      for (const ig of syncResult.instagramAccounts) {
        const igId = (ig as { id?: string }).id;
        if (typeof igId === 'string' && igId.trim()) {
          await persistGrantedScopesByPlatformUser({
            userId,
            companyId: companyId || null,
            platform: 'instagram',
            platformUserId: igId,
            grantedScopes: grantedMetaScopes,
          });
        }
      }
      for (const th of syncResult.threadsAccounts) {
        const thId = (th as { id?: string }).id;
        if (typeof thId === 'string' && thId.trim()) {
          await persistGrantedScopesByPlatformUser({
            userId,
            companyId: companyId || null,
            platform: 'threads',
            platformUserId: thId,
            grantedScopes: grantedMetaScopes,
          });
        }
      }
    }

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId).catch((e) =>
        console.warn('[instagram/callback] setup credits check failed:', e?.message)
      );
    }

    const successDest = returnTo && returnTo.startsWith('/') ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    const accountName = syncResult.instagramAccounts[0]?.username || syncResult.instagramAccounts[0]?.name || 'Instagram';
    return res.redirect(
      `${successDest}${sep}` +
        new URLSearchParams({
          connected: platform,
          threads: syncResult.threadsAccounts.length > 0 ? 'enabled' : 'disabled',
          account: accountName,
          success: 'true',
          page_name: selectedPage.pageName,
          instagram_username: selectedPage.instagramUsername ?? '',
          instagram_id: selectedPage.instagramId,
        }).toString()
    );
  } catch (err: any) {
    console.error('Instagram OAuth callback error:', err);
    return res.redirect(`${errDest}?error=${encodeURIComponent(err.message || 'Connection failed')}`);
  }
}
