/**
 * Platform Adapter
 * 
 * Main adapter that routes publish requests to platform-specific implementations.
 * Handles token retrieval, refresh, and error handling.
 * 
 * Platform-specific adapters:
 * - LinkedIn: backend/adapters/linkedinAdapter.ts ✅
 * - X (Twitter): backend/adapters/xAdapter.ts ✅
 * - Instagram: backend/adapters/instagramAdapter.ts ✅
 * - Facebook: backend/adapters/facebookAdapter.ts ✅
 * - YouTube: backend/adapters/youtubeAdapter.ts ✅
 * - TikTok: backend/adapters/tiktokAdapter.ts ✅
 * - Spotify: backend/adapters/spotifyAdapter.ts ✅
 * - Star Maker: backend/adapters/starmakerAdapter.ts (API not available)
 * - Suno: backend/adapters/sunoAdapter.ts (API not available)
 * - Pinterest: backend/adapters/pinterestAdapter.ts ✅
 */

import { supabase } from '../db/supabaseClient';
import { getToken, setToken, isTokenExpiringSoon } from '../auth/tokenStore';
import { refreshPlatformToken } from '../auth/tokenRefresh';
import { getScheduledPost, getSocialAccount } from '../db/queries';
import { publishToLinkedIn } from './linkedinAdapter';
import { publishToX } from './xAdapter';
import { publishToInstagram } from './instagramAdapter';
import { publishToFacebook } from './facebookAdapter';
import { publishToYouTube } from './youtubeAdapter';
import { publishToTikTok } from './tiktokAdapter';
import { publishToSpotify } from './spotifyAdapter';
import { publishToStarMaker } from './starmakerAdapter';
import { publishToSuno } from './sunoAdapter';
import { publishToPinterest } from './pinterestAdapter';

export interface PublishResult {
  success: boolean;
  platform_post_id?: string;
  post_url?: string;
  published_at?: Date;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

/**
 * Publish a scheduled post to its platform
 * 
 * Flow:
 * 1. Fetch scheduled_post and social_account from DB
 * 2. Decrypt and retrieve OAuth token
 * 3. Refresh token if expired/expiring soon
 * 4. Call platform-specific adapter
 * 5. On success: update scheduled_posts with platform_post_id and status='published'
 * 6. On failure: update status and return error for retry logic
 * 
 * @param scheduledPostId - UUID of scheduled_posts record
 * @param socialAccountId - UUID of social_accounts record
 */
export async function publishToPlatform(
  scheduledPostId: string,
  socialAccountId: string
): Promise<PublishResult> {
  console.log(`🚀 Publishing post ${scheduledPostId} via account ${socialAccountId}`);

  try {
    // Step 1: Fetch scheduled post
    const scheduledPost = await getScheduledPost(scheduledPostId);
    if (!scheduledPost) {
      throw new Error(`Scheduled post ${scheduledPostId} not found`);
    }

    // Step 2: Fetch social account
    const socialAccount = await getSocialAccount(socialAccountId);
    if (!socialAccount) {
      throw new Error(
        `Social account not found (id: ${socialAccountId}). ` +
        `Please reconnect your account in Settings → Social Accounts.`
      );
    }

    // Step 3: Get and validate token
    let token = await getToken(socialAccountId);
    if (!token) {
      throw new Error(
        `Your ${socialAccount.platform} account token is missing or could not be decrypted. ` +
        `Please reconnect your ${socialAccount.platform} account in Settings → Social Accounts.`
      );
    }

    // Step 4: Refresh token if needed
    if (isTokenExpiringSoon(token, 5)) {
      console.log(`🔄 Token expiring soon, refreshing...`);
      const refreshedToken = await refreshPlatformToken(socialAccount.platform, socialAccountId, token);
      if (!refreshedToken) {
        throw new Error(
          `Your ${socialAccount.platform} session has expired. ` +
          `Please reconnect your account in Settings → Social Accounts.`
        );
      }
      token = refreshedToken;
    }

    // Step 5: Route to platform-specific adapter
    const platform = socialAccount.platform.toLowerCase();
    let result: PublishResult;

    switch (platform) {
      case 'linkedin':
        result = await publishToLinkedIn(scheduledPost, socialAccount, token);
        break;
      case 'twitter':
      case 'x':
        result = await publishToX(scheduledPost, socialAccount, token);
        break;
      case 'instagram':
        result = await publishToInstagram(scheduledPost, socialAccount, token);
        break;
      case 'facebook':
        result = await publishToFacebook(scheduledPost, socialAccount, token);
        break;
      case 'youtube':
        result = await publishToYouTube(scheduledPost, socialAccount, token);
        break;
      case 'tiktok':
        result = await publishToTikTok(scheduledPost, socialAccount, token);
        break;
      case 'spotify':
        result = await publishToSpotify(scheduledPost, socialAccount, token);
        break;
      case 'starmaker':
      case 'star_maker':
        result = await publishToStarMaker(scheduledPost, socialAccount, token);
        break;
      case 'suno':
        result = await publishToSuno(scheduledPost, socialAccount, token);
        break;
      case 'pinterest':
        result = await publishToPinterest(scheduledPost, socialAccount, token);
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    return result;
  } catch (error: any) {
    console.error(`❌ Publish error:`, error.message);
    return {
      success: false,
      error: {
        code: 'PUBLISH_ERROR',
        message: error.message,
        retryable: true, // Most errors are retryable
      },
    };
  }
}

// Token refresh is now handled by refreshPlatformToken() from '../auth/tokenRefresh'

