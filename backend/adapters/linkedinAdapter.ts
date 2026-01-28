/**
 * LinkedIn Adapter
 * 
 * Publishes posts to LinkedIn using the LinkedIn API v2.
 * 
 * API Documentation: https://docs.microsoft.com/en-us/linkedin/shared/integrations/people/share-api
 * 
 * Required OAuth Scopes:
 * - w_member_social (for posting)
 * 
 * To obtain API credentials:
 * 1. Create LinkedIn app at https://www.linkedin.com/developers/apps
 * 2. Request "Marketing Developer Platform" access (for posting)
 * 3. Configure redirect URI: {BASE_URL}/api/auth/linkedin/callback
 * 4. Get Client ID and Client Secret
 * 
 * Environment Variables:
 * - LINKEDIN_CLIENT_ID
 * - LINKEDIN_CLIENT_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing without real credentials)
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string;
  title?: string;
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
 * Publish post to LinkedIn
 */
export async function publishToLinkedIn(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled (for testing)
  if (process.env.USE_MOCK_PLATFORMS === 'true') {
    console.log('🧪 MOCK MODE: Simulating LinkedIn post');
    return {
      success: true,
      platform_post_id: `mock_linkedin_${Date.now()}`,
      post_url: `https://www.linkedin.com/feed/update/${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // LinkedIn API endpoint for sharing
    const apiUrl = 'https://api.linkedin.com/v2/ugcPosts';

    // Format content automatically for LinkedIn platform
    const formatted = formatContentForPlatform(post.content, 'linkedin', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    // Log warnings if content was modified
    if (formatted.warnings.length > 0) {
      console.warn('⚠️ Content formatting warnings:', formatted.warnings);
    }

    // Build LinkedIn UGC post payload
    // LinkedIn requires specific structure for UGC posts
    const payload = {
      author: `urn:li:person:${account.platform_user_id}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: formatted.text,
          },
          shareMediaCategory: post.media_urls && post.media_urls.length > 0
            ? 'ARTICLE'
            : 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    // Add media if present
    if (post.media_urls && post.media_urls.length > 0) {
      // TODO: Upload media to LinkedIn first, get media URN
      // For now, assume media already uploaded or use article URL
      const shareContent = payload.specificContent['com.linkedin.ugc.ShareContent'] as any;
      shareContent.media = post.media_urls.map(
        (url, index) => ({
          status: 'READY',
          description: {
            text: post.title || '',
          },
          media: url,
          title: {
            text: post.title || `Media ${index + 1}`,
          },
        })
      );
    }

    // Make API call
    const response = await axios.post(apiUrl, payload, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    // Extract post ID from LinkedIn response
    // Response format: { "id": "urn:li:ugcPost:123456789" }
    const platformPostId = response.data.id;
    const postIdPart = platformPostId.split(':').pop();
    const postUrl = `https://www.linkedin.com/feed/update/${postIdPart}`;

    console.log(`✅ LinkedIn post published: ${postUrl}`);

    return {
      success: true,
      platform_post_id: platformPostId,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('LinkedIn API error:', error.response?.data || error.message);

    // Handle specific LinkedIn errors
    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'LINKEDIN_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect account.',
          retryable: false, // Don't retry auth errors
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'LINKEDIN_RATE_LIMIT',
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'LINKEDIN_API_ERROR',
        message: error.response?.data?.message || error.message,
        retryable: true,
      },
    };
  }
}


