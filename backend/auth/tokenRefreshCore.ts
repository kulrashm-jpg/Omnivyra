/** Part 1/2 of tokenRefresh.ts — verbatim split (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
/**
 * Token Refresh Service
 * 
 * Handles OAuth token refresh for all social media platforms.
 * 
 * Each platform has different refresh token endpoints and requirements.
 * This service provides platform-specific refresh implementations.
 * 
 * Environment Variables (required for each platform):
 * - LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 * - TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
 * - FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
 * - YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
 * - INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET (uses Facebook)
 */

import axios from 'axios';
import { getToken, setToken, TokenObject } from './tokenStore';
import { supabase } from '../db/supabaseClient';
import { config } from '@/config';
import { getOAuthCredentialsForPlatform } from './oauthCredentialResolver';
import { withRefreshLock } from './refreshLock';
import { buildXRefreshLockKey } from './refreshAccountResolver';


export type TwitterTokenRefreshStatus = 'refreshed' | 'still_valid' | 'requires_reconnect' | 'refresh_failed';

export type TwitterTokenRefreshInput = {
  account_id: string;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
};

export type TwitterTokenRefreshResult = {
  access_token?: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  status: TwitterTokenRefreshStatus;
};

function isExpiredOrNearExpiry(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs < Date.now() + 5 * 60 * 1000;
}

/**
 * Refresh token for LinkedIn
 */
export async function refreshLinkedInToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for LinkedIn account:', socialAccountId);
    return null;
  }

  const credentials = await getOAuthCredentialsForPlatform('linkedin');
  const clientId = credentials?.client_id || config.LINKEDIN_CLIENT_ID;
  const clientSecret = credentials?.client_secret || config.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ LinkedIn credentials not configured');
    return null;
  }

  try {
    const response = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ LinkedIn refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 5184000; // Default 60 days
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || currentToken.refresh_token, // LinkedIn may not return new refresh token
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    // Save new token
    await setToken(socialAccountId, newToken);

    console.log('✅ LinkedIn token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ LinkedIn token refresh error:', errorDetails);
    
    // Check if refresh token is invalid
    if (error.response?.status === 400 || error.response?.status === 401) {
      console.error('⚠️ Refresh token may be invalid or expired - user needs to reconnect');
    }
    
    return null;
  }
}

/**
 * Refresh X/Twitter token when expired or within five minutes of expiry.
 *
 * Rotation contract: X v2 issues a NEW refresh_token on every successful
 * refresh and invalidates the old one. We must always prefer the rotated
 * token from the response. Reusing the old refresh_token is only a last-
 * resort fallback (X spec says rotation is mandatory; absence of a new
 * refresh_token in the response is anomalous and worth a loud warning).
 */
export async function refreshTwitterTokenIfNeeded(
  account: TwitterTokenRefreshInput
): Promise<TwitterTokenRefreshResult> {
  if (!isExpiredOrNearExpiry(account.token_expires_at)) {
    return {
      access_token: account.access_token,
      refresh_token: account.refresh_token ?? null,
      token_expires_at: account.token_expires_at ?? null,
      status: 'still_valid',
    };
  }

  // Lock-guarded refresh — see backend/auth/refreshLock.ts for rationale.
  // If another worker is mid-refresh for this account, treat as still_valid:
  // by the time the lock holder finishes, our caller's next read will pick
  // up the fresh token from DB.
  // Unified lock key — see refreshAccountResolver.ts. Connector path resolves
  // org→account_id and contends on the same key.
  const lockKey = buildXRefreshLockKey(account.account_id);
  return withRefreshLock<TwitterTokenRefreshResult>(
    lockKey,
    () => doRefreshTwitterTokenInner(account),
    {
      access_token: account.access_token,
      refresh_token: account.refresh_token ?? null,
      token_expires_at: account.token_expires_at ?? null,
      status: 'still_valid',
    },
    'refreshTwitterTokenIfNeeded',
  );
}

/**
 * The shared refresh-lifecycle vocabulary.
 *
 * 'skipped' means "the sweep looked at this account and correctly did nothing"
 * — the token is still valid, or the account has no refresh token to rotate.
 * It is NOT a failed refresh and must never park an account.
 */
export type RefreshOutcomeStatus = 'success' | 'failed' | 'requires_reconnect' | 'skipped';

/**
 * Strip credential material out of a provider error before it is persisted.
 *
 * last_refresh_error and last_provider_error store provider text verbatim, and
 * some providers echo the offending token back in the error body. Without this
 * the lifecycle row becomes a place secrets are written in the clear. Only
 * values the caller KNOWS are secret are removed — no heuristics that could
 * mangle a genuine diagnostic. Short values are ignored so a coincidental
 * fragment can never blank out useful text.
 */
export function redactCredentials(text: string, secrets: Array<string | undefined | null>): string {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 8) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

/**
 * Record one refresh outcome on the shared social_accounts lifecycle columns.
 *
 * Renamed from recordTwitterRefreshOutcome: the state machine below was never
 * X-specific, only its call sites were. X keeps calling it with exactly the
 * statuses it always used, so its behaviour is unchanged; every other platform
 * now reaches the same bookkeeping through refreshPlatformToken.
 */
export async function recordRefreshOutcome(
  accountId: string,
  status: RefreshOutcomeStatus,
  error: string | null,
): Promise<void> {
  // A skip is an OBSERVATION, not an outcome: stamp only that the sweep looked.
  //
  // refresh_status is CHECK-constrained to
  //   CONNECTED | TOKEN_EXPIRING | TOKEN_REFRESHING | TOKEN_EXPIRED |
  //   PROVIDER_REAUTH_REQUIRED | REFRESH_FAILED_RETRYABLE |
  //   REFRESH_FAILED_FATAL | SCHEDULER_UNREACHABLE
  // and none of those means "nothing to do". Inventing a value would violate
  // the constraint; reusing a failure value would libel a healthy account. So
  // the skip touches no status, no retry count and no connection state — which
  // is also exactly what "must never park" requires. Distinguishing the two
  // skip reasons needs no new column: refresh_token presence and
  // token_expires_at already say which one it was.
  if (status === 'skipped') {
    try {
      await ownedDbTable('social_accounts')
        .update({ last_refresh_attempt_at: new Date().toISOString() })
        .eq('id', accountId);
    } catch (err: any) {
      console.warn('[tokenRefresh] failed to record refresh skip:', err?.message);
    }
    return;
  }
  return recordRefreshOutcomeInner(accountId, status, error);
}

async function recordRefreshOutcomeInner(
  accountId: string,
  status: 'success' | 'failed' | 'requires_reconnect',
  error: string | null,
): Promise<void> {
  // ── Deterministic token-lifecycle state machine (PHASE EX3/EX5) ───────────
  // Lifecycle columns added in supabase/migrations/20260517_x_token_lifecycle
  // _columns.sql. Writes are serialized per-account by the surrounding
  // refreshLock, so the retry-count read-modify-write below is race-free.
  // Mapping is fully deterministic — no derived-state heuristics:
  //
  //   success                       -> CONNECTED                (retry_count=0)
  //   requires_reconnect            -> PROVIDER_REAUTH_REQUIRED  (terminal)
  //   failed + invalid_grant        -> PROVIDER_REAUTH_REQUIRED  (fatal: reauth)
  //   failed + invalid_client       -> REFRESH_FAILED_FATAL      (fatal: config)
  //   failed + other (net/5xx/...)  -> REFRESH_FAILED_RETRYABLE  (++retry_count)
  //   retryable & retry_count>=CEIL -> PROVIDER_REAUTH_REQUIRED  (bounded retries)
  //
  // connection_state (existing enum: CONNECTED|TOKEN_EXPIRED|PROVIDER_REAUTH_
  // REQUIRED) is mirrored so oauthLifecycleScheduler / admin UI stay correct.
  const RETRY_CEILING = 4; // mirrors REFRESH_FAILURE_CEILING in connectionState.ts
  const errText = (error ?? '').toLowerCase();
  const nowIso = new Date().toISOString();

  try {
    let refreshStatus:
      | 'CONNECTED' | 'PROVIDER_REAUTH_REQUIRED'
      | 'REFRESH_FAILED_FATAL' | 'REFRESH_FAILED_RETRYABLE';
    let connectionState: 'CONNECTED' | 'TOKEN_EXPIRED' | 'PROVIDER_REAUTH_REQUIRED';
    let nextRetryCount = 0;
    let successAt: string | null = null;

    if (status === 'success') {
      refreshStatus = 'CONNECTED';
      connectionState = 'CONNECTED';
      nextRetryCount = 0;
      successAt = nowIso;
    } else if (status === 'requires_reconnect' || errText.includes('invalid_grant')) {
      refreshStatus = 'PROVIDER_REAUTH_REQUIRED';
      connectionState = 'PROVIDER_REAUTH_REQUIRED';
    } else if (errText.includes('invalid_client')) {
      refreshStatus = 'REFRESH_FAILED_FATAL';   // app credentials wrong — operator alert
      connectionState = 'TOKEN_EXPIRED';
    } else {
      // Transient (network / 5xx / unknown) — bounded retry.
      const { data: cur } = await ownedDbTable('social_accounts')
        .select('refresh_retry_count')
        .eq('id', accountId)
        .maybeSingle();
      const prior = Number((cur as any)?.refresh_retry_count ?? 0);
      nextRetryCount = prior + 1;
      if (nextRetryCount >= RETRY_CEILING) {
        refreshStatus = 'PROVIDER_REAUTH_REQUIRED';   // retries exhausted
        connectionState = 'PROVIDER_REAUTH_REQUIRED';
      } else {
        refreshStatus = 'REFRESH_FAILED_RETRYABLE';
        connectionState = 'TOKEN_EXPIRED';
      }
    }

    const patch: Record<string, unknown> = {
      refresh_status:         refreshStatus,
      last_refresh_attempt_at: nowIso,
      last_refresh_error:     status === 'success' ? null : error,
      refresh_retry_count:    nextRetryCount,
      connection_state:       connectionState,
      last_live_check_at:     nowIso,
      last_live_check_status: status,
      last_provider_error:    status === 'success' ? null : error,
    };
    if (successAt) patch.last_successful_refresh_at = successAt;

    // PROVIDER_REAUTH_REQUIRED is terminal — either the provider said
    // invalid_grant, or bounded retries are exhausted. Until now that set a
    // LABEL, not a STOP: the refresh resolver selects on `is_active`, so an
    // account marked terminal kept being selected and retried every ten
    // minutes. Production found @omnivyra at refresh_retry_count = 4104
    // against a ceiling of 4, is_active still true, its provider error
    // ("invalid_request: Value passed for the token was invalid") matching
    // neither invalid_grant nor invalid_client and so taking the transient
    // branch forever.
    //
    // Parking here — in the one place that already computes the terminal
    // determination — ends the loop, and the existing UI renders the account
    // as "Not connected". A reconnect sets is_active back to true.
    if (connectionState === 'PROVIDER_REAUTH_REQUIRED') {
      patch.is_active = false;
    }

    await ownedDbTable('social_accounts').update(patch).eq('id', accountId);
  } catch (err: any) {
    // Non-fatal — telemetry write failure must not bubble up over the actual refresh result.
    console.warn('[tokenRefresh] failed to record refresh outcome:', err?.message);
  }
}

async function doRefreshTwitterTokenInner(
  account: TwitterTokenRefreshInput
): Promise<TwitterTokenRefreshResult> {
  if (!account.refresh_token) {
    // CRITICAL: an X token is at/past expiry but no refresh_token is in DB.
    // The account cannot self-recover — user must reconnect. Loud log so this
    // is visible in production observability, not a quiet error.
    console.error(
      '[tokenRefresh][CRITICAL] X account has expired access_token AND no refresh_token in DB — reconnect required',
      JSON.stringify({ account_id: account.account_id })
    );
    await recordRefreshOutcome(account.account_id, 'requires_reconnect', 'no_refresh_token_in_db');
    return { status: 'requires_reconnect' };
  }

  const credentials = await getOAuthCredentialsForPlatform('x');
  const clientId = credentials?.client_id || config.X_CLIENT_ID;
  const clientSecret = credentials?.client_secret || config.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Twitter credentials not configured');
    await recordRefreshOutcome(account.account_id, 'failed', 'credentials_not_configured');
    return { status: 'refresh_failed' };
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
      }
    );

    if (!response.data.access_token) {
      console.error('Twitter refresh: No access token in response');
      await recordRefreshOutcome(account.account_id, 'failed', 'no_access_token_in_response');
      return { status: 'refresh_failed' };
    }

    const rotatedRefreshToken = response.data.refresh_token as string | undefined;
    const finalRefreshToken = rotatedRefreshToken || account.refresh_token;

    if (rotatedRefreshToken) {
      console.log(
        `[tokenRefresh] refresh_token rotated for X account ${account.account_id}`
      );
    } else {
      // Anomalous per X spec — log loudly so we notice if X behaviour changes.
      console.warn(
        `[tokenRefresh] refresh_token reused (fallback) for X account ${account.account_id} — X did not return a rotated token in response`
      );
    }

    const expiresIn = response.data.expires_in || 7200;
    const refreshed: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: finalRefreshToken,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    // setToken persists to social_accounts AND mirrors to
    // community_ai_platform_tokens (see mirrorTokenToCommunityAi). Both tables
    // receive the freshly-rotated refresh_token in the same call.
    await setToken(account.account_id, refreshed);
    await recordRefreshOutcome(account.account_id, 'success', null);

    return {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? null,
      token_expires_at: refreshed.expires_at ?? null,
      status: 'refreshed',
    };
  } catch (error: any) {
    const errorData = error.response?.data;
    // Capture the X error class — invalid_grant (refresh_token expired/used),
    // invalid_client (credentials wrong), invalid_request (bad request shape).
    // This is what surfaces in the verify-config tooltip so operators can
    // tell at a glance whether the user must reconnect or whether the X app
    // credentials are wrong.
    const errorCode = errorData?.error || error.message || 'unknown_error';
    const errorDescription = errorData?.error_description || '';
    const persistedError = errorDescription
      ? `${errorCode}: ${errorDescription}`
      : errorCode;
    console.error(
      `[tokenRefresh] X refresh failed for account ${account.account_id}:`,
      errorCode,
      errorDescription
    );
    await recordRefreshOutcome(account.account_id, 'failed', persistedError);
    return { status: 'refresh_failed' };
  }
}

export async function refreshTwitterToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  const result = await refreshTwitterTokenIfNeeded({
    account_id: socialAccountId,
    access_token: currentToken.access_token,
    refresh_token: currentToken.refresh_token ?? null,
    token_expires_at: new Date(0).toISOString(),
  });

  if (result.status !== 'refreshed' || !result.access_token) return null;
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token ?? undefined,
    expires_at: result.token_expires_at ?? undefined,
    token_type: currentToken.token_type || 'Bearer',
  };
}

/**
 * Refresh token for Facebook (and Instagram)
 * 
 * Facebook Graph API uses long-lived tokens that can be refreshed.
 * Instagram uses Facebook tokens since it's part of Facebook Graph API.
 */
export async function refreshFacebookToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  const credentials = await getOAuthCredentialsForPlatform('facebook');
  const appId = credentials?.client_id || config.FACEBOOK_APP_ID || config.FACEBOOK_CLIENT_ID;
  const appSecret = credentials?.client_secret || config.FACEBOOK_APP_SECRET || config.FACEBOOK_CLIENT_SECRET;

  if (!appId || !appSecret) {
    console.error('❌ Facebook credentials not configured');
    return null;
  }

  try {
    // Facebook provides long-lived access tokens
    // To refresh, exchange short-lived token for long-lived token
    // Or refresh existing long-lived token

    const response = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken.access_token,
      },
    });

    if (!response.data.access_token) {
      console.error('❌ Facebook refresh: No access token in response');
      
      // Try alternative: if we have refresh_token, use it
      if (currentToken.refresh_token) {
        return await refreshFacebookTokenWithRefreshToken(socialAccountId, currentToken, appId, appSecret);
      }
      
      return null;
    }

    // Facebook long-lived tokens expire in ~60 days
    // Calculate expiration from expires_in
    const expiresIn = response.data.expires_in || 5184000; // Default 60 days
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: currentToken.refresh_token, // Facebook doesn't use refresh tokens the same way
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ Facebook token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Facebook token refresh error:', errorDetails);

    // If token exchange fails, try to get new long-lived token from refresh_token if available
    if (currentToken.refresh_token) {
      return await refreshFacebookTokenWithRefreshToken(socialAccountId, currentToken, appId, appSecret);
    }

    return null;
  }
}

/**
 * Helper: Refresh Facebook token using refresh_token
 */
async function refreshFacebookTokenWithRefreshToken(
  socialAccountId: string,
  currentToken: TokenObject,
  appId: string,
  appSecret: string
): Promise<TokenObject | null> {
  try {
    const response = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken.refresh_token,
      },
    });

    if (!response.data.access_token) {
      return null;
    }

    const expiresIn = response.data.expires_in || 5184000;
    const refreshedToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: 'Bearer',
    };

    await setToken(socialAccountId, refreshedToken);
    console.log('✅ Facebook token refreshed via refresh_token');
    return refreshedToken;
  } catch (error) {
    console.error('❌ Facebook refresh token also failed:', error);
    return null;
  }
}

/**
 * Refresh token for Instagram
 * 
 * Instagram uses Facebook Graph API, so token refresh is similar to Facebook
 */
export async function refreshInstagramToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  // Instagram tokens are Facebook tokens, use same refresh logic
  return refreshFacebookToken(socialAccountId, currentToken);
}

/**
 * Refresh token for YouTube (Google OAuth)
 * 
 * YouTube uses Google OAuth 2.0
 */
export async function refreshYouTubeToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for YouTube account:', socialAccountId);
    return null;
  }

  const credentials = await getOAuthCredentialsForPlatform('youtube');
  const clientId = credentials?.client_id || process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = credentials?.client_secret || process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ YouTube credentials not configured');
    return null;
  }

  try {
    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: currentToken.refresh_token,
        grant_type: 'refresh_token',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ YouTube refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 3600; // Default 1 hour
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: currentToken.refresh_token, // Google refresh tokens don't expire
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ YouTube token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ YouTube token refresh error:', errorDetails);
    
    if (error.response?.status === 400) {
      const errorData = error.response?.data;
      if (errorData?.error === 'invalid_grant') {
        console.error('⚠️ Refresh token invalid or expired - user needs to reconnect');
      }
    }
    
    return null;
  }
}

/**
 * Refresh token for Spotify
 */
