/**
 * Facebook Adapter
 * 
 * Publishes posts to Facebook Pages using the Facebook Graph API.
 * 
 * API Documentation: https://developers.facebook.com/docs/graph-api/reference/page/feed
 * 
 * Required OAuth Scopes:
 * - pages_manage_posts
 * - pages_read_engagement
 * - pages_show_list
 * 
 * To obtain credentials:
 * 1. Create Facebook app at https://developers.facebook.com/apps/
 * 2. Add "Facebook Login" product
 * 3. Get Page Access Token with pages_manage_posts permission
 * 4. Get Page ID (from Page Settings > About)
 * 
 * Environment Variables:
 * - FACEBOOK_APP_ID
 * - FACEBOOK_APP_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
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
  platform_user_id: string; // Facebook Page ID
  username?: string;
}

interface Token {
  access_token: string;
  token_type?: string;
}

/**
 * Upload photo to Facebook Page
 * Returns attachment ID that can be used in post
 */
async function uploadPhotoToFacebook(
  imageUrl: string,
  caption: string,
  pageId: string,
  token: Token
): Promise<string> {
  // Facebook Graph API allows posting photos directly with URL
  // But if we need to upload from local file, use /photos endpoint with multipart/form-data
  // For now, we'll use the feed endpoint with 'link' parameter or 'attached_media' for photos
  
  // If image URL is provided, we can use it directly in the feed post
  // Facebook will automatically fetch and display the image
  return imageUrl; // Return URL for use in post
}

/**
 * Upload video to Facebook Page
 * 
 * Facebook video upload requires:
 * 1. Initiate upload session
 * 2. Upload video in chunks (for large files)
 * 3. Wait for processing
 * 4. Create post with video
 */
async function uploadVideoToFacebook(
  videoUrl: string,
  description: string,
  pageId: string,
  token: Token
): Promise<string> {
  // For video URLs, Facebook can fetch and process them
  // For direct video upload, use /videos endpoint with multipart/form-data
  // For now, we'll use the video URL directly in the post
  return videoUrl;
}

/**
 * Publish post to Facebook Page
 */
export async function publishToFacebook(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (process.env.USE_MOCK_PLATFORMS === 'true') {
    console.log('🧪 MOCK MODE: Simulating Facebook post');
    return {
      success: true,
      platform_post_id: `mock_facebook_${Date.now()}`,
      post_url: `https://www.facebook.com/${account.platform_user_id}/posts/${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    const pageId = account.platform_user_id;
    const apiUrl = `https://graph.facebook.com/v18.0/${pageId}/feed`;

    // Format content automatically for Facebook
    const formatted = formatContentForPlatform(post.content, 'facebook', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    // Log warnings
    if (formatted.warnings.length > 0) {
      console.warn('⚠️ Facebook content formatting warnings:', formatted.warnings);
    }

    // Build post message
    let message = formatted.text;

    // Add hashtags inline (Facebook supports them)
    if (formatted.hashtags.length > 0) {
      message += ' ' + formatted.hashtags.join(' ');
    }

    // Build payload
    const payload: any = {
      message: message,
      access_token: token.access_token,
    };

    // Handle media
    if (post.media_urls && post.media_urls.length > 0) {
      const firstMedia = post.media_urls[0];
      const isVideo = firstMedia.match(/\.(mp4|mov|avi|webm)$/i);
      const isImage = firstMedia.match(/\.(jpg|jpeg|png|gif|webp)$/i);

      if (isImage) {
        // For images, use 'link' parameter or 'attached_media'
        // Facebook will fetch and display the image
        payload.link = firstMedia;
        // Alternatively, use attached_media for uploaded photos:
        // payload.attached_media = [{ media_fbid: photoId }];
      } else if (isVideo) {
        // For videos, use 'source' parameter for video URL
        // Or use 'description' for video description
        payload.source = firstMedia;
        if (post.title || post.content) {
          payload.description = post.title || formatted.text;
        }
      }
    }

    // Add link if present (but no media)
    if (formatted.links.length > 0 && (!post.media_urls || post.media_urls.length === 0)) {
      payload.link = formatted.links[0];
    }

    // Make API call
    const response = await axios.post(apiUrl, null, {
      params: payload,
    });

    // Extract post ID from response
    // Response format: { "id": "{page-id}_{post-id}" }
    const postId = response.data.id;
    const postIdPart = postId.split('_').pop();
    const postUrl = `https://www.facebook.com/${pageId}/posts/${postIdPart}`;

    console.log(`✅ Facebook post published: ${postUrl}`);

    return {
      success: true,
      platform_post_id: postId,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('Facebook API error:', error.response?.data || error.message);

    // Handle specific Facebook Graph API errors
    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'FACEBOOK_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect Facebook account.',
          retryable: false,
        },
      };
    }

    if (error.response?.status === 403) {
      const errorData = error.response?.data?.error || {};
      return {
        success: false,
        error: {
          code: 'FACEBOOK_PERMISSION_DENIED',
          message: `Permission denied: ${errorData.message || 'Insufficient permissions'}. Check that you have pages_manage_posts permission.`,
          retryable: false,
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'FACEBOOK_RATE_LIMIT',
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
          code: 'FACEBOOK_VALIDATION_ERROR',
          message: errorData.message || 'Invalid post content',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'FACEBOOK_API_ERROR',
        message: error.response?.data?.error?.message || error.message,
        retryable: true,
      },
    };
  }
}
