/** Part 2/2 of tokenRefresh.ts — verbatim split (barrel preserved; importers unchanged). */
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

import { refreshLinkedInToken, refreshTwitterTokenIfNeeded, refreshTwitterToken, refreshFacebookToken, refreshInstagramToken, refreshYouTubeToken } from './tokenRefreshCore';

export async function refreshSpotifyToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for Spotify account:', socialAccountId);
    return null;
  }

  // Resolve via the same single source of truth used by the foreground OAuth
  // callbacks: DB-stored platform_oauth_configs first, then env fallback.
  // Reading process.env directly here would silently skip credentials added
  // via the Super Admin UI, leaving the cron refresh job returning null.
  const credentials = await getOAuthCredentialsForPlatform('spotify');
  const clientId = credentials?.client_id;
  const clientSecret = credentials?.client_secret;

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

  // Resolve via the same single source of truth used by the foreground OAuth
  // callbacks (DB-stored platform_oauth_configs → env fallback). Direct
  // process.env reads here would silently skip Super-Admin-configured
  // credentials and let tokens drift to expiry.
  const credentials = await getOAuthCredentialsForPlatform('tiktok');
  const clientKey = credentials?.client_id;
  const clientSecret = credentials?.client_secret;

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

  // Resolve via the same single source of truth used by the foreground OAuth
  // callbacks (DB-stored platform_oauth_configs → env fallback).
  const credentials = await getOAuthCredentialsForPlatform('reddit');
  const clientId = credentials?.client_id;
  const clientSecret = credentials?.client_secret;

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

  // Resolve via the same single source of truth used by the foreground OAuth
  // callbacks (DB-stored platform_oauth_configs → env fallback). The resolver
  // maps 'pinterest' → PINTEREST_APP_ID/PINTEREST_APP_SECRET internally.
  const credentials = await getOAuthCredentialsForPlatform('pinterest');
  const appId = credentials?.client_id;
  const appSecret = credentials?.client_secret;

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

