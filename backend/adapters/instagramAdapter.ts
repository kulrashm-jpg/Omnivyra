/**
 * Instagram Adapter
 * 
 * Publishes posts to Instagram using the Instagram Graph API.
 * 
 * IMPORTANT: Instagram requires:
 * - Instagram Business Account or Creator Account
 * - Facebook Page connected to Instagram account
 * - Facebook app with Instagram Graph API product
 * 
 * API Documentation: https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
 * 
 * Required OAuth Scopes:
 * - instagram_basic
 * - instagram_content_publish
 * - pages_show_list (to list connected pages)
 * 
 * To obtain credentials:
 * 1. Create Facebook app at https://developers.facebook.com/apps/
 * 2. Add "Instagram Graph API" product
 * 3. Connect Instagram Business Account to Facebook Page
 * 4. Get Page Access Token with instagram permissions
 * 5. Get Instagram Business Account ID (IG User ID)
 * 
 * Environment Variables:
 * - FACEBOOK_APP_ID
 * - FACEBOOK_APP_SECRET
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
  platform_user_id: string; // Instagram Business Account ID (IG User ID)
  username?: string;
}

interface Token {
  access_token: string;
  token_type?: string;
}

/**
 * Upload image to Instagram (via Facebook Graph API)
 * 
 * Returns media container ID that can be published
 */
async function uploadImageToInstagram(
  imageUrl: string,
  caption: string,
  instagramAccountId: string,
  token: Token
): Promise<{ container_id: string }> {
  // Step 1: Create media container for image
  const containerUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}/media`;
  
  const containerResponse = await axios.post(containerUrl, {
    image_url: imageUrl,
    caption: caption,
  }, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
    params: {
      access_token: token.access_token,
    },
  });

  return {
    container_id: containerResponse.data.id,
  };
}

/**
 * Upload video to Instagram (via Facebook Graph API)
 * 
 * Instagram video upload requires 3 steps:
 * 1. Create container with video URL
 * 2. Check container status (wait for processing)
 * 3. Publish container
 */
async function uploadVideoToInstagram(
  videoUrl: string,
  caption: string,
  instagramAccountId: string,
  token: Token
): Promise<{ container_id: string }> {
  // Step 1: Create media container for video
  const containerUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}/media`;
  
  const containerResponse = await axios.post(containerUrl, {
    media_type: 'REELS', // or 'VIDEO' for regular posts
    video_url: videoUrl,
    caption: caption,
  }, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
    params: {
      access_token: token.access_token,
    },
  });

  const containerId = containerResponse.data.id;

  // Step 2: Check container status (wait for video processing)
  let status = 'IN_PROGRESS';
  let attempts = 0;
  const maxAttempts = 30; // Wait up to 5 minutes (10s intervals)

  while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    
    const statusUrl = `https://graph.facebook.com/v18.0/${containerId}`;
    const statusResponse = await axios.get(statusUrl, {
      params: {
        fields: 'status_code',
        access_token: token.access_token,
      },
    });

    status = statusResponse.data.status_code;
    attempts++;

    if (status === 'FINISHED') {
      break;
    }

    if (status === 'ERROR') {
      throw new Error('Video processing failed on Instagram');
    }
  }

  if (status !== 'FINISHED') {
    throw new Error('Video processing timeout - Instagram took too long to process');
  }

  return {
    container_id: containerId,
  };
}

/**
 * Publish media container to Instagram
 */
async function publishInstagramContainer(
  containerId: string,
  instagramAccountId: string,
  token: Token
): Promise<{ id: string }> {
  const publishUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`;
  
  const response = await axios.post(publishUrl, {
    creation_id: containerId,
  }, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
    params: {
      access_token: token.access_token,
    },
  });

  return {
    id: response.data.id,
  };
}

/**
 * Publish post to Instagram
 */
export async function publishToInstagram(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating Instagram post');
    return {
      success: true,
      platform_post_id: `mock_instagram_${Date.now()}`,
      post_url: `https://www.instagram.com/p/mock_${Date.now()}/`,
      published_at: new Date(),
    };
  }

  try {
    // Instagram requires media for posts (images or videos)
    if (!post.media_urls || post.media_urls.length === 0) {
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_NO_MEDIA',
          message: 'Instagram posts require at least one image or video',
          retryable: false,
        },
      };
    }

    // Format content automatically for Instagram
    const formatted = formatContentForPlatform(post.content, 'instagram', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    // Log warnings
    if (formatted.warnings.length > 0) {
      console.warn('⚠️ Instagram content formatting warnings:', formatted.warnings);
    }

    // Build caption with hashtags (Instagram supports up to 30 hashtags, 2200 chars total)
    let caption = formatted.text;
    if (formatted.hashtags.length > 0) {
      // Add hashtags at the end (common Instagram practice)
      caption += '\n\n' + formatted.hashtags.join(' ');
    }

    const instagramAccountId = account.platform_user_id;
    let containerId: string;

    // Determine media type (assume first media URL determines type)
    const firstMediaUrl = post.media_urls[0];
    const isVideo = firstMediaUrl.match(/\.(mp4|mov|avi|webm)$/i);

    // Upload media and get container ID
    if (isVideo) {
      // Video upload (requires processing time)
      const result = await uploadVideoToInstagram(
        firstMediaUrl,
        caption,
        instagramAccountId,
        token
      );
      containerId = result.container_id;
    } else {
      // Image upload (instant)
      const result = await uploadImageToInstagram(
        firstMediaUrl,
        caption,
        instagramAccountId,
        token
      );
      containerId = result.container_id;
    }

    // Publish the container
    const published = await publishInstagramContainer(
      containerId,
      instagramAccountId,
      token
    );

    // Instagram API returns media ID (not post permalink directly)
    // Post URL format: https://www.instagram.com/p/{media_id}/
    const postUrl = `https://www.instagram.com/p/${published.id}/`;

    console.log(`✅ Instagram post published: ${postUrl}`);

    return {
      success: true,
      platform_post_id: published.id,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('Instagram API error:', error.response?.data || error.message);

    // Handle specific Instagram/Facebook Graph API errors
    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect Instagram account.',
          retryable: false,
        },
      };
    }

    if (error.response?.status === 403) {
      // Instagram specific permissions error
      const errorMessage = error.response?.data?.error?.message || 'Permission denied';
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_PERMISSION_DENIED',
          message: `Instagram API error: ${errorMessage}. Check that your account is a Business/Creator account and connected to a Facebook Page.`,
          retryable: false,
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_RATE_LIMIT',
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true,
        },
      };
    }

    // Handle validation errors
    if (error.response?.status === 400) {
      const errorData = error.response?.data?.error || {};
      return {
        success: false,
        error: {
          code: 'INSTAGRAM_VALIDATION_ERROR',
          message: errorData.message || 'Invalid post content or media',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'INSTAGRAM_API_ERROR',
        message: error.response?.data?.error?.message || error.message,
        retryable: true,
      },
    };
  }
}
