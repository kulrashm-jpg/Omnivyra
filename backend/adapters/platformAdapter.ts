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
import { getToken, isTokenExpiringSoon, markSocialAccountNeedsReauth } from '../auth/tokenStore';
import { refreshPlatformToken, refreshTwitterTokenIfNeeded } from '../auth/tokenRefresh';
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
import { validatePlatformContentCompatibility } from '../services/platformContentValidator';
import { logger } from '../services/logger';
import { CAPABILITY_LOG_EVENTS, type CapabilityLogPayload } from '../../lib/shared/social/capabilityEvents';
import type { PublishResult } from './platformAdapterTypes';
export type { PublishResult } from './platformAdapterTypes';

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
 * @param options - Optional publish hints. Phase 1B.2.2 adds
 *                  `replyToPlatformPostId`: when set, instructs platforms with
 *                  native reply chains (Twitter/X via in_reply_to_tweet_id) to
 *                  thread the post as a reply to the given platform_post_id.
 *                  Adapters without native reply chains (LinkedIn / Instagram /
 *                  Facebook / others) ignore this option and publish standalone.
 */
export type PublishToPlatformOptions = {
  replyToPlatformPostId?: string;
};

export async function publishToPlatform(
  scheduledPostId: string,
  socialAccountId: string,
  options?: PublishToPlatformOptions
): Promise<PublishResult> {
  console.log(`🚀 Publishing post ${scheduledPostId} via account ${socialAccountId}`);

  try {
    // Step 1: Fetch scheduled post
    const scheduledPost = await getScheduledPost(scheduledPostId);
    if (!scheduledPost) {
      throw new Error(`Scheduled post ${scheduledPostId} not found`);
    }

    // Step 1.5: Authoritative capability validation (Round-2 Phase 2). This
    // is the lowest-shared layer — every publish path (queue worker,
    // publishNow, API, scheduled jobs) routes through publishToPlatform, so
    // wiring the check here guarantees no caller can bypass it.
    const compatibility = validatePlatformContentCompatibility({
      platform: scheduledPost.platform,
      contentSignals: { contentType: scheduledPost.content_type },
      payload: {
        hasText: !!(scheduledPost.content && scheduledPost.content.trim().length > 0),
        mediaUrls: scheduledPost.media_urls ?? [],
      },
    });
    if (compatibility.ok === false) {
      const failure = compatibility;
      const eventName = failure.code === 'CAPABILITY_UNRESOLVED'
        ? CAPABILITY_LOG_EVENTS.UNRESOLVED
        : CAPABILITY_LOG_EVENTS.REJECTED;
      const payload: CapabilityLogPayload = {
        surface: 'publishToPlatform',
        publishSource: 'adapter',
        platform: failure.platform ?? scheduledPost.platform,
        resolvedCapability: failure.capability,
        contentType: scheduledPost.content_type,
        code: failure.code,
        scheduledPostId,
      };
      logger.warn(eventName, payload);
      return {
        success: false,
        error: {
          code: failure.code,
          message: failure.message,
          retryable: false,
        },
      };
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

    const platform = socialAccount.platform.toLowerCase();

    // Step 4: Refresh token if needed
    if (platform === 'x' || platform === 'twitter') {
      const refreshResult = await refreshTwitterTokenIfNeeded({
        account_id: socialAccountId,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        token_expires_at: token.expires_at ?? null,
      });

      if (refreshResult.status === 'requires_reconnect' || refreshResult.status === 'refresh_failed') {
        // The credential is proven unrecoverable: refresh was attempted and the
        // provider refused. Park the connection so the rest of the product stops
        // treating it as healthy — see the note at the sibling site below.
        await markSocialAccountNeedsReauth(
          socialAccountId,
          `${socialAccount.platform} publish: refresh ${refreshResult.status}`,
        );
        throw new Error(
          `Your ${socialAccount.platform} session has expired. ` +
          `Please reconnect your account in Settings â†’ Social Accounts.`
        );
      }

      if (refreshResult.access_token) {
        token = {
          ...token,
          access_token: refreshResult.access_token,
          refresh_token: refreshResult.refresh_token ?? token.refresh_token,
          expires_at: refreshResult.token_expires_at ?? token.expires_at,
        };
      }
    } else if (isTokenExpiringSoon(token, 5)) {
      console.log(`🔄 Token expiring soon, refreshing...`);
      const refreshedToken = await refreshPlatformToken(socialAccount.platform, socialAccountId, token);
      if (!refreshedToken) {
        // Refresh was ATTEMPTED and could not produce a credential — either the
        // provider rejected it or no refresh token exists (LinkedIn issues a
        // 60-day access token and no refresh token unless the app is approved
        // for programmatic refresh). Either way this connection cannot publish
        // again until a human reconnects it.
        //
        // Park it, exactly as ingestion does on the same evidence. Without this
        // `is_active` stays true, so platform health keeps reporting the account
        // as connected, every later campaign keeps allocating slots to it, and
        // each one fails the same way — the failure being visible only inside an
        // individual post's error_message. Reusing the existing primitive means
        // the UI already renders it as "Not connected" and a reconnect clears it.
        //
        // Platform-agnostic on purpose: this is the shared publish path for every
        // registered platform, not a LinkedIn branch.
        await markSocialAccountNeedsReauth(
          socialAccountId,
          `${socialAccount.platform} publish: token refresh unavailable`,
        );
        throw new Error(
          `Your ${socialAccount.platform} session has expired. ` +
          `Please reconnect your account in Settings → Social Accounts.`
        );
      }
      token = refreshedToken;
    }

    // Step 5: Route to platform-specific adapter
    let result: PublishResult;

    switch (platform) {
      case 'linkedin':
        result = await publishToLinkedIn(scheduledPost, socialAccount, token);
        break;
      case 'twitter':
      case 'x':
        result = await publishToX(scheduledPost, socialAccount, token, {
          replyToPlatformPostId: options?.replyToPlatformPostId,
        });
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
