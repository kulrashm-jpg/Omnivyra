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

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

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
 * Refresh token for X (Twitter)
 * 
 * Twitter OAuth 2.0 refresh token flow
 */
export async function refreshTwitterToken(
  socialAccountId: string,
  currentToken: TokenObject
): Promise<TokenObject | null> {
  if (!currentToken.refresh_token) {
    console.error('❌ No refresh token available for Twitter account:', socialAccountId);
    return null;
  }

  const clientId = process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Twitter credentials not configured');
    return null;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        refresh_token: currentToken.refresh_token,
        grant_type: 'refresh_token',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    if (!response.data.access_token) {
      console.error('❌ Twitter refresh: No access token in response');
      return null;
    }

    const expiresIn = response.data.expires_in || 7200; // Default 2 hours
    const newToken: TokenObject = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token || currentToken.refresh_token,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      token_type: response.data.token_type || 'Bearer',
    };

    await setToken(socialAccountId, newToken);

    console.log('✅ Twitter token refreshed successfully');
    return newToken;
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ Twitter token refresh error:', errorDetails);
    
    if (error.response?.status === 400 || error.response?.status === 401) {
      console.error('⚠️ Refresh token may be invalid - user needs to reconnect');
    }
    
    return null;
  }
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
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('❌ Facebook credentials not configured');
    return null;
  }

  try {
    // Facebook provides long-lived access tokens
    // To refresh, exchange short-lived token for long-lived token
    // Or refresh existing long-lived token

    const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
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
    const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
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

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

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
