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
 * 3. Configure callback URI: {BASE_URL}/api/auth/twitter/callback
 * 4. Get API Key, API Secret, Bearer Token
 * 
 * Environment Variables:
 * - TWITTER_CLIENT_ID
 * - TWITTER_CLIENT_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';

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
 * Publish post to X (Twitter)
 */
export async function publishToX(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating X/Twitter post');
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

    // Add media if present (media_ids required for images/videos)
    if (post.media_urls && post.media_urls.length > 0) {
      // TODO: Upload media to Twitter first using media/upload endpoint
      // For now, assume media already uploaded or handle separately
      // payload.media = { media_ids: [...] };
      
      console.warn('⚠️ Media upload not yet implemented for X/Twitter');
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

