/**
 * X (Twitter) Adapter
 * 
 * Publishes posts to X/Twitter using the Twitter API v2.
 * 
 * API Documentation: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets
 * 
 * Required OAuth Scopes:
 * - tweet.read
 * - tweet.write
 * - users.read
 * 
 * To obtain API credentials:
 * 1. Create Twitter app at https://developer.twitter.com/en/portal/dashboard
 * 2. Enable Twitter API v2 access
 * 3. Configure callback URI: {BASE_URL}/auth/x/callback
 * 4. Get API Key, API Secret, Bearer Token
 * 
 * Environment Variables:
 * - TWITTER_CLIENT_ID
 * - TWITTER_CLIENT_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
 */

import axios from 'axios';
import type { PublishResult } from './platformAdapterTypes';
// P3-A — reuse the EXISTING pipeline error vocabulary; no new codes.
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';
import { uploadXMedia } from './xMedia';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string;
  hashtags?: string[];
  media_urls?: string[];
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string;
  username?: string;
}

interface Token {
  access_token: string;
  token_type?: string;
}

/**
 * Phase 1B.2.2 — optional publish hints.
 *
 * `replyToPlatformPostId`: chain this tweet as a reply to the given tweet id
 * via Twitter API v2's `reply.in_reply_to_tweet_id`. Used by the thread
 * publish orchestrator to build native X thread chains. When undefined, the
 * tweet publishes as a standalone post.
 */
export type PublishToXOptions = {
  replyToPlatformPostId?: string;
};

/**
 * Publish post to X (Twitter)
 */
export async function publishToX(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token,
  options?: PublishToXOptions
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating X/Twitter post', {
      reply_to: options?.replyToPlatformPostId ?? null,
    });
    return {
      success: true,
      platform_post_id: `mock_twitter_${Date.now()}`,
      post_url: `https://twitter.com/${account.username || 'user'}/status/${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // Twitter API v2 endpoint for creating tweets
    const apiUrl = 'https://api.twitter.com/2/tweets';

    // Format content automatically for Twitter/X platform
    const formatted = formatContentForPlatform(post.content, 'x', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    // Log warnings if content was modified
    if (formatted.warnings.length > 0) {
      console.warn('⚠️ Content formatting warnings:', formatted.warnings);
    }

    let text = formatted.text;

    const payload: any = {
      text: text,
    };

    // Phase 1B.2.2 — native thread reply chain.
    // When replyToPlatformPostId is set, attach Twitter API v2's
    // `reply.in_reply_to_tweet_id`. Used by the thread publish orchestrator
    // to chain children to their parent's tweet id.
    if (options?.replyToPlatformPostId) {
      payload.reply = { in_reply_to_tweet_id: options.replyToPlatformPostId };
    }

    // Upload media first — v2 tweet-create only accepts already-uploaded
    // media_ids. Best-effort: if the upload yields no ids (e.g. missing
    // media.write scope, or a transient failure), fall back to a text-only
    // tweet rather than failing the whole post.
    if (post.media_urls && post.media_urls.length > 0) {
      // P3-A — a post that ASKED for media must never be reported as a
      // successful text-only publication. Previously both the empty-ids case
      // and the thrown-error case fell through to a text-only tweet and
      // returned success, so a reviewed image post shipped as bare text with
      // only a server-log warning. Media failure is now a truthful failure.
      //
      // Retryable: unlike a switched-off capability, an upload failure here is
      // typically transient (scope, rate limit, network), so the EXISTING
      // BullMQ retry/DLQ semantics should get another attempt. No new retry
      // mechanism is introduced.
      let mediaIds: string[] = [];
      try {
        mediaIds = await uploadXMedia(post.media_urls, token);
      } catch (mediaError: any) {
        const detail = mediaError?.response?.data || mediaError?.message || 'unknown error';
        console.warn('⚠️ X media upload failed — refusing to post text-only:', detail);
        return {
          success: false,
          error: {
            code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
            message:
              `This post has ${post.media_urls.length} attached media item(s), but the X media upload failed, ` +
              `so publishing would have sent TEXT ONLY. Nothing was published.`,
            retryable: true,
          },
        };
      }
      if (mediaIds.length > 0) {
        payload.media = { media_ids: mediaIds };
        console.log(`✅ X media uploaded (${mediaIds.length}): ${mediaIds.join(', ')}`);
      } else {
        console.warn('⚠️ X media upload produced no media_ids — refusing to post text-only');
        return {
          success: false,
          error: {
            code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
            message:
              `This post has ${post.media_urls.length} attached media item(s), but X returned no usable media, ` +
              `so publishing would have sent TEXT ONLY. Nothing was published.`,
            retryable: true,
          },
        };
      }
    }

    // Make API call
    const response = await axios.post(apiUrl, payload, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    // Extract tweet ID from response
    // Response format: { "data": { "id": "1234567890", "text": "..." } }
    const tweetId = response.data.data.id;
    const username = account.username || account.platform_user_id;
    const postUrl = `https://twitter.com/${username}/status/${tweetId}`;

    console.log(`✅ X/Twitter post published: ${postUrl}`);

    return {
      success: true,
      platform_post_id: tweetId,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('X/Twitter API error:', error.response?.data || error.message);

    // Handle specific Twitter errors
    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'TWITTER_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect account.',
          retryable: false,
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'TWITTER_RATE_LIMIT',
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true,
        },
      };
    }

    // Handle validation errors
    if (error.response?.status === 400) {
      const errorDetail = error.response.data?.detail;
      return {
        success: false,
        error: {
          code: 'TWITTER_VALIDATION_ERROR',
          message: errorDetail || 'Invalid tweet content',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'TWITTER_API_ERROR',
        message: error.response?.data?.detail || error.message,
        retryable: true,
      },
    };
  }
}

