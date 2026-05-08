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

async function recordTwitterRefreshOutcome(
  accountId: string,
  status: 'success' | 'failed' | 'requires_reconnect',
  error: string | null,
): Promise<void> {
  try {
    await ownedDbTable('social_accounts')
      .update({
        refresh_status: status,
        last_refresh_attempt_at: new Date().toISOString(),
        last_refresh_error: status === 'success' ? null : error,
      })
      .eq('id', accountId);
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
    await recordTwitterRefreshOutcome(account.account_id, 'requires_reconnect', 'no_refresh_token_in_db');
    return { status: 'requires_reconnect' };
  }

  const credentials = await getOAuthCredentialsForPlatform('x');
  const clientId = credentials?.client_id || config.X_CLIENT_ID;
  const clientSecret = credentials?.client_secret || config.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Twitter credentials not configured');
    await recordTwitterRefreshOutcome(account.account_id, 'failed', 'credentials_not_configured');
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
      await recordTwitterRefreshOutcome(account.account_id, 'failed', 'no_access_token_in_response');
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
    await recordTwitterRefreshOutcome(account.account_id, 'success', null);

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
    await recordTwitterRefreshOutcome(account.account_id, 'failed', persistedError);
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
export async function refreshSpotifyToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for Spotify account:', socialAccountId);
    return null;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Spotify credentials not configured');
    return null;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ Spotify refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 3600; // Default 1 hour
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ Spotify token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Spotify token refresh error:', errorDetails);
    return null;
  }
}

/**
 * Refresh token for TikTok
 * 
 * TikTok OAuth 2.0 refresh token flow
 */
export async function refreshTikTokToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for TikTok account:', socialAccountId);
    return null;
  }

  const clientKey = process.env.TIKTOK_CLIENT_ID;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    console.error('❌ TikTok credentials not configured');
    return null;
  }

  try {
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.data?.access_token) {
      console.error('❌ TikTok refresh: No access token in response');
      return null;
    }

    const tokenData = response.data.data;
    const expiresIn = tokenData.expires_in || 7200; // Default 2 hours
    const newToken: TokenObject = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: tokenData.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ TikTok token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ TikTok token refresh error:', errorDetails);
    
    if (error.response?.status === 400 || error.response?.status === 401) {
      console.error('⚠️ Refresh token may be invalid or expired - user needs to reconnect');
    }
    
    return null;
  }
}

/**
 * Refresh token for Reddit
 *
 * Reddit OAuth2: POST to /api/v1/access_token with grant_type=refresh_token.
 * Uses Basic auth (client_id:client_secret). Reddit may not return new refresh_token.
 */
export async function refreshRedditToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for Reddit account:', socialAccountId);
    return null;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Reddit credentials not configured');
    return null;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
          'User-Agent': 'virality/1.0',
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ Reddit refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 3600; // Default 1 hour
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ Reddit token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Reddit token refresh error:', errorDetails);

    if (error.response?.status === 400 || error.response?.status === 401) {
      console.error('⚠️ Refresh token may be invalid or expired - user needs to reconnect');
    }

    return null;
  }
}

/**
 * Refresh token for Pinterest
 * 
 * Pinterest OAuth 2.0 refresh token flow
 */
export async function refreshPinterestToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for Pinterest account:', socialAccountId);
    return null;
  }

  const appId = process.env.PINTEREST_APP_ID;
  const appSecret = process.env.PINTEREST_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('❌ Pinterest credentials not configured');
    return null;
  }

  try {
    const credentials = Buffer.from(`${appId}:${appSecret}`).toString('base64');

    const response = await axios.post(
      'https://api.pinterest.com/v5/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ Pinterest refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 2592000; // Default 30 days
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ Pinterest token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Pinterest token refresh error:', errorDetails);
    
    if (error.response?.status === 400 || error.response?.status === 401) {
      console.error('⚠️ Refresh token may be invalid or expired - user needs to reconnect');
    }
    
    return null;
  }
}

/**
 * Generic token refresh function that routes to platform-specific implementation
 */
export async function refreshPlatformToken(
  platform: string,
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  const platformLower = platform.toLowerCase();

  console.log(`🔄 Attempting to refresh ${platformLower} token for account ${socialAccountId}`);

  switch (platformLower) {
    case 'linkedin':
      return refreshLinkedInToken(socialAccountId, currentToken);

    case 'twitter':
    case 'x':
      return refreshTwitterToken(socialAccountId, currentToken);

    case 'facebook':
      return refreshFacebookToken(socialAccountId, currentToken);

    case 'instagram':
      return refreshInstagramToken(socialAccountId, currentToken);

    case 'threads':
      return refreshInstagramToken(socialAccountId, currentToken);

    case 'youtube':
      return refreshYouTubeToken(socialAccountId, currentToken);

    case 'tiktok':
      return refreshTikTokToken(socialAccountId, currentToken);

    case 'spotify':
      return refreshSpotifyToken(socialAccountId, currentToken);

    case 'pinterest':
      return refreshPinterestToken(socialAccountId, currentToken);

    case 'reddit':
      return refreshRedditToken(socialAccountId, currentToken);

    default:
      console.warn(`⚠️ Token refresh not implemented for platform: ${platform}`);
      return null;
  }
}

/**
 * Unified refresh buffer — both the social_accounts and connector refresh
 * paths use this so the two never disagree about which tokens are "near
 * expiry" and need rotation. 15 minutes is tight enough that rotated tokens
 * stay fresh well past most request windows, and loose enough that the
 * 10-minute cron tick catches tokens before they expire.
 */
export const REFRESH_BUFFER_MS = 15 * 60 * 1000;

/**
 * Refresh all social_accounts rows for a company whose token expires within bufferMs.
 *
 * Used on dashboard load and by cron so short-lived access tokens (e.g. X — 2h)
 * don't appear "Token Expired" between user sessions. Per-account failures are
 * swallowed (fire-and-forget at the caller level); accounts without a stored
 * refresh_token are skipped — the user must reconnect once to seed it.
 */
export async function refreshExpiringSocialAccountsForCompany(
  companyId: string,
  bufferMs: number = REFRESH_BUFFER_MS
): Promise<{ checked: number; refreshed: number; skipped: number; errors: number }> {
  const summary = { checked: 0, refreshed: 0, skipped: 0, errors: 0 };

  const { data: roleRows } = await ownedDbTable('user_company_roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('status', 'active');
  const userIds = (roleRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
  if (userIds.length === 0) return summary;

  const cutoffIso = new Date(Date.now() + bufferMs).toISOString();
  const { data: rows } = await ownedDbTable('social_accounts')
    .select('id, platform, token_expires_at, refresh_token')
    .in('user_id', userIds)
    .eq('is_active', true)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .lt('token_expires_at', cutoffIso);

  const accounts = rows ?? [];
  summary.checked = accounts.length;

  await Promise.all(
    accounts.map(async (acc: { id: string; platform: string }) => {
      try {
        const token = await getToken(acc.id);
        if (!token?.access_token) {
          summary.skipped++;
          return;
        }

        if (acc.platform === 'x' || acc.platform === 'twitter') {
          const refreshed = await refreshTwitterTokenIfNeeded({
            account_id: acc.id,
            access_token: token.access_token,
            refresh_token: token.refresh_token ?? null,
            token_expires_at: token.expires_at ?? null,
          });

          if (refreshed.status === 'refreshed') {
            summary.refreshed++;
          } else if (refreshed.status === 'refresh_failed') {
            summary.errors++;
          } else {
            summary.skipped++;
          }
        } else {
          if (!token.refresh_token) {
            summary.skipped++;
            return;
          }
          const refreshed = await refreshPlatformToken(acc.platform, acc.id, token);
          if (refreshed?.access_token) {
            summary.refreshed++;
          } else {
            summary.errors++;
          }
        }
      } catch (err: any) {
        summary.errors++;
        console.warn(`[refreshExpiringSocialAccountsForCompany] ${acc.platform} ${acc.id}:`, err?.message);
      }
    })
  );

  return summary;
}

/**
 * Refresh expiring tokens across ALL companies. Intended for the cron loop —
 * pairs with the connector cron job so social_accounts and
 * community_ai_platform_tokens are kept fresh on the same cadence.
 *
 * Iterates active companies and calls refreshExpiringSocialAccountsForCompany
 * for each. setToken's mirror to community_ai_platform_tokens (added in
 * tokenStore.ts) keeps the connector table in sync as a side effect, so the
 * two refresh paths cannot drift on the X refresh_token.
 */
export async function refreshAllExpiringSocialAccounts(
  bufferMs: number = REFRESH_BUFFER_MS,
): Promise<{ companies: number; checked: number; refreshed: number; skipped: number; errors: number }> {
  const totals = { companies: 0, checked: 0, refreshed: 0, skipped: 0, errors: 0 };

  const { data: companyRows } = await ownedDbTable('companies')
    .select('id')
    .eq('status', 'active');

  const companies = (companyRows ?? []) as { id: string }[];
  totals.companies = companies.length;

  for (const c of companies) {
    try {
      const summary = await refreshExpiringSocialAccountsForCompany(c.id, bufferMs);
      totals.checked += summary.checked;
      totals.refreshed += summary.refreshed;
      totals.skipped += summary.skipped;
      totals.errors += summary.errors;
    } catch (err: any) {
      totals.errors++;
      console.warn(`[refreshAllExpiringSocialAccounts] company ${c.id}:`, err?.message);
    }
  }

  return totals;
}
