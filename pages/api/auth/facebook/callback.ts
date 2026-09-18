import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { setToken, encryptTokenColumns, TokenObject } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import {
  syncInstagramAndThreadsFromMeta,
  resolveFacebookPageTarget,
  type FacebookPageTargetResolution,
} from '../../../../backend/services/metaDerivedAccountsService';
import { persistGrantedScopes, normaliseScopes } from '../../../../backend/auth/oauthScopePersistence';
import { logOAuthEvent, safeHost } from '../../../../backend/auth/oauthTelemetry';
import { describeProviderError } from '../../../../backend/auth/safeErrorLog';
import { assertTenantAccess } from '../../../../backend/security/TenantGuard';

/**
 * Why this Facebook connection cannot publish — in words the operator can act
 * on. Stored on `social_accounts.last_provider_error` (the column platform
 * health and the connection-state helpers already read) and echoed to the
 * browser, so "connected but nothing publishes" is never a silent state.
 */
function describeMissingPageTarget(resolution: FacebookPageTargetResolution): string {
  if (resolution.status === 'no_pages') {
    return 'This Facebook login does not administer any Facebook Page that granted a Page access token. ' +
      'Facebook only allows publishing to a Page, using that Page\'s own token — a personal profile cannot be ' +
      'published to. Give this login an admin role on a Page, then reconnect and approve pages_show_list and ' +
      'pages_manage_posts.';
  }
  if (resolution.status === 'selection_required') {
    const names = resolution.candidates
      .map((page) => `${page.name ?? 'unnamed'} (${page.id})`)
      .join(', ');
    return `This Facebook login administers ${resolution.candidates.length} Pages — ${names} — and none of them is ` +
      'bound to this connection. A Page is NOT chosen automatically, because that would publish to a destination ' +
      'nobody selected. No Page target was stored and this connection cannot publish until one is selected.';
  }
  if (resolution.status === 'lookup_failed') {
    return `Facebook did not return the list of Pages this login administers (${resolution.reason}), so no Page ` +
      'target could be stored. Reconnect the Facebook account; if it keeps failing, the app may be missing the ' +
      'pages_show_list grant.';
  }
  return 'No Facebook Page target could be resolved for this connection.';
}

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

    // ROUTE-AUTH-001: the connection is written for the SESSION user only, and
    // only into a company that user is an active member of. The signed state
    // proves where the flow started, not who is finishing it — so the state's
    // userId must match the session, and nothing falls back to it.
    const { user: sessionUser } = await getSupabaseUserFromRequest(req);
    if (!sessionUser?.id) {
      logOAuthEvent({ event: 'oauth_failure', provider: 'facebook', callback_host: callbackHost, company_id: companyId ?? null, state_user_id: stateUserId ?? null, failure_point: 'unauthorized', failure_detail: 'no session' });
      return res.redirect(`${errDest}?error=${encodeURIComponent('Login session required — please log in and try again')}`);
    }
    if (stateUserId && stateUserId !== sessionUser.id) {
      logOAuthEvent({ event: 'oauth_failure', provider: 'facebook', callback_host: callbackHost, company_id: companyId ?? null, user_id: sessionUser.id, state_user_id: stateUserId, failure_point: 'invalid_oauth_state', failure_detail: 'state user does not match session user' });
      return res.redirect(`${errDest}?error=${encodeURIComponent('This connection was started by a different user — please try again')}`);
    }
    if (companyId) {
      const tenant = await assertTenantAccess({ userId: sessionUser.id, organizationId: companyId });
      if (tenant.ok !== true) {
        logOAuthEvent({ event: 'oauth_failure', provider: 'facebook', callback_host: callbackHost, company_id: companyId, user_id: sessionUser.id, state_user_id: stateUserId ?? null, failure_point: 'unauthorized', failure_detail: `company access denied (${tenant.reason})` });
        return res.redirect(`${errDest}?error=${encodeURIComponent('You do not have access to this company')}`);
      }
    }
    const userId = sessionUser.id;

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

    const accountName = profile.name || 'Facebook Account';

    const companyIdUuid = companyId && /^[0-9a-f-]{36}$/i.test(companyId) ? companyId : null;
    let existingAccount: { id: string; linked_page_id?: string | null } | null = null;
    if (companyIdUuid) {
      const { data: tenantRow } = await supabase
        .from('social_accounts')
        .select('id, linked_page_id')
        .eq('user_id', userId)
        .eq('company_id', companyIdUuid)
        .eq('platform', 'facebook')
        .eq('platform_user_id', profile.id)
        .maybeSingle();
      if (tenantRow) existingAccount = tenantRow;
    }

    // ── Page target ──────────────────────────────────────────────────────────
    //
    // `profile.id` is the Facebook USER id, and the token exchanged above is a
    // USER token. Graph accepts feed publishing ONLY at a Page node, with that
    // Page's own token, so a connection that stores nothing else can never
    // publish. The Page and its token are read from the same
    // `GET /v22.0/me/accounts?fields=id,name,access_token` call this repo
    // already makes for the Instagram/Threads derivation, and are persisted on
    // the columns the schema already reserves for exactly this:
    // `linked_page_id` (the Page) and `page_access_token` (its credential).
    //
    // The Page token — not the user token — becomes the row's stored
    // credential, which is what `getToken()` hands the publish path and what
    // the live CHECK constraint `social_accounts_facebook_token_chk`
    // (`facebook AND is_active ⇒ page_access_token IS NOT NULL`) requires. It
    // is also what metaDerivedAccountsService already stores for the
    // Instagram/Threads rows derived from the very same Pages.
    //
    // Page discovery is never allowed to abort the connect. Losing an
    // authenticated connection because one Graph read failed would turn a
    // recoverable "no target yet" into "reconnect from scratch"; the
    // unresolved branch below already refuses to publish, which is the part
    // that has to be safe.
    let pageTarget: FacebookPageTargetResolution;
    try {
      pageTarget = await resolveFacebookPageTarget({
        accessToken,
        facebookUserId: String(profile.id),
        currentPageId: existingAccount?.linked_page_id ?? null,
      });
    } catch (pageLookupError: any) {
      pageTarget = {
        status: 'lookup_failed',
        reason: String(pageLookupError?.message ?? pageLookupError).slice(0, 200),
        candidates: [],
      };
    }
    const resolvedPage = pageTarget.status === 'resolved' ? pageTarget.page : null;
    const pageTargetProblem = resolvedPage
      ? null
      : describeMissingPageTarget(pageTarget);

    if (!resolvedPage) {
      // No silent auto-pick, and no connection that looks publishable but is
      // not: the row is parked inactive with the reason, so platform health and
      // the publish path both see the truth instead of a user node dressed up
      // as a Page.
      console.warn('[facebook/callback] no publishable Page target:', pageTarget.status);
      logOAuthEvent({
        event: 'oauth_failure',
        provider: 'facebook',
        callback_host: callbackHost,
        company_id: companyId ?? null,
        user_id: userId,
        state_user_id: stateUserId ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: `facebook page target ${pageTarget.status}`,
      });
    }

    const tokenObj: TokenObject = {
      access_token: resolvedPage ? resolvedPage.accessToken : accessToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
    };
    const encryptedCols = encryptTokenColumns(tokenObj);

    // Written only when a Page is actually resolved. On an unresolved
    // reconnect the previously bound target is left alone rather than nulled —
    // `is_active: false` already stops it being used, and destroying a good
    // target because one lookup came back empty would be its own defect.
    const pageColumns = resolvedPage
      ? { linked_page_id: resolvedPage.id, page_access_token: encryptedCols.access_token }
      : {};

    let accountId: string;

    if (existingAccount) {
      accountId = existingAccount.id;
      await supabase
        .from('social_accounts')
        .update({
          account_name: accountName,
          is_active: Boolean(resolvedPage),
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_provider_error: pageTargetProblem,
          ...pageColumns,
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
          is_active: Boolean(resolvedPage),
          token_expires_at: expiresAt,
          last_sync_at: new Date().toISOString(),
          access_token: encryptedCols.access_token,
          refresh_token: encryptedCols.refresh_token,
          last_provider_error: pageTargetProblem,
          ...pageColumns,
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
      } else {
        // The scope list above is Facebook-Page-only ON PURPOSE (see the note there:
        // Meta rejects the entire consent dialog with "Invalid Scopes" when Instagram
        // products are not fully provisioned). A token without instagram_basic can
        // therefore never derive an Instagram account, so finding none here is the
        // NORMAL outcome rather than a failure.
        //
        // It used to be logged as nothing at all, which made a successful sync that
        // found nothing indistinguishable from a sync that never ran -- the exact
        // ambiguity that makes a healthy Facebook connect look like a broken
        // Instagram one. State the outcome and where Instagram actually comes from.
        console.log(
          '[facebook/callback] no Instagram business account derived from this Facebook token ' +
          '(expected: Facebook scopes exclude Instagram; connect Instagram at /api/auth/instagram)',
        );
      }
    } catch (syncError: any) {
      console.warn('[facebook/callback] Instagram/Threads derivation skipped:', syncError?.message);
    }

    console.log('✅ Facebook account saved:', {
      accountId,
      accountName,
      pageTarget: resolvedPage ? resolvedPage.id : 'none',
      publishable: Boolean(resolvedPage),
    });

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
    // The OAuth handshake succeeded either way — that is what `success=true`
    // has always meant here. Whether the connection can PUBLISH is a separate
    // fact, and it is now reported rather than assumed: `pageTarget` names the
    // bound Page, or is `none` with the reason attached. The row itself is
    // inactive in the `none` case, so nothing can publish on a guess.
    const pageTargetParam = resolvedPage
      ? `&pageTarget=${encodeURIComponent(resolvedPage.id)}`
      : `&pageTarget=none&pageTargetReason=${encodeURIComponent(pageTargetProblem ?? 'unknown')}`;
    return res.redirect(`${successDest}${sep}connected=${platform}&threads=${derivedThreadsCount > 0 ? 'enabled' : 'disabled'}&account=${encodeURIComponent(accountName)}&success=true${pageTargetParam}`);

  } catch (error: any) {
    console.error('Facebook OAuth callback error:', describeProviderError(error));
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
