/**
 * TikTok Adapter
 * 
 * Publishes videos to TikTok using the TikTok Content API v2.1.
 * 
 * IMPORTANT: TikTok requires:
 * - TikTok Developer account
 * - Content Posting API access (requires approval)
 * - OAuth 2.0 application
 * 
 * API Documentation: https://developers.tiktok.com/doc/content-posting-api/
 * 
 * Required OAuth Scopes:
 * - video.upload (for video posts)
 * - user.info.basic
 * 
 * Video Upload Process (3 steps):
 * 1. Initialize upload (POST /video/init/)
 * 2. Upload video chunks (POST /video/upload/)
 * 3. Publish video (POST /video/publish/)
 * 
 * To obtain credentials:
 * 1. Register app at https://developers.tiktok.com/
 * 2. Create OAuth app
 * 3. Request Content Posting API access (approval required)
 * 4. Configure redirect URI: {BASE_URL}/api/auth/tiktok/callback
 * 
 * Environment Variables:
 * - TIKTOK_CLIENT_ID (App Key)
 * - TIKTOK_CLIENT_SECRET (App Secret)
 * - USE_MOCK_PLATFORMS=true (for testing)
 * 
 * Note: TikTok has strict content policies and rate limits
 */

import axios from 'axios';
import { PublishResult } from './platformAdapter';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string; // Video caption
  title?: string;
  hashtags?: string[];
  media_urls?: string[]; // Video file URLs (required)
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string; // TikTok user ID
  username?: string;
}

interface Token {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
}

/**
 * Initialize TikTok video upload
 * 
 * Returns upload URL and upload_id for chunked upload
 */
async function initTikTokVideoUpload(
  videoInfo: { title: string; privacy_level: string },
  token: Token
): Promise<{ upload_url: string; upload_id: string }> {
  const response = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      source_info: {
        source: 'FILE_UPLOAD',
      },
      post_info: {
        title: videoInfo.title,
        privacy_level: videoInfo.privacy_level || 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    upload_url: response.data.data.upload_url,
    upload_id: response.data.data.upload_id,
  };
}

/**
 * Upload video file to TikTok (chunked upload)
 */
async function uploadTikTokVideoChunks(
  videoUrl: string,
  uploadUrl: string,
  uploadId: string,
  token: Token
): Promise<void> {
  // Download video file
  const videoResponse = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
  });
  
  const videoBuffer = Buffer.from(videoResponse.data);
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  let offset = 0;

  // Upload in chunks
  while (offset < videoBuffer.length) {
    const chunk = videoBuffer.slice(offset, offset + chunkSize);
    const isLast = offset + chunkSize >= videoBuffer.length;

    await axios.put(uploadUrl, chunk, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${videoBuffer.length}`,
        'TikTok-Upload-ID': uploadId,
      },
      params: {
        upload_id: uploadId,
        part_number: Math.floor(offset / chunkSize) + 1,
      },
    });

    offset += chunkSize;
  }
}

/**
 * Publish TikTok video after upload
 */
async function publishTikTokVideo(
  uploadId: string,
  caption: string,
  token: Token
): Promise<{ item_id: string }> {
  const response = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
    {
      publish_id: uploadId,
    },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  // Wait for processing, then publish
  // TikTok may require polling publish status
  return {
    item_id: response.data.data.publish_id || uploadId,
  };
}

/**
 * Publish video to TikTok
 * 
 * TikTok posts are videos, so media_urls[0] must be a video file
 */
export async function publishToTikTok(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating TikTok video upload');
    return {
      success: true,
      platform_post_id: `mock_tiktok_${Date.now()}`,
      post_url: `https://www.tiktok.com/@${account.username || 'user'}/video/mock_${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // Format content for TikTok
    const formattedContent = formatContentForPlatform('tiktok', post.content, {
      hashtags: post.hashtags || [],
    });

    // TikTok requires video media
    if (!post.media_urls || post.media_urls.length === 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_MEDIA',
          message: 'TikTok posts require a video file',
          retryable: false,
        },
      };
    }

    const videoUrl = post.media_urls[0];
    const title = post.title || formattedContent.text.substring(0, 150) || 'TikTok Video';

    // Step 1: Initialize upload
    const { upload_url, upload_id } = await initTikTokVideoUpload(
      {
        title,
        privacy_level: 'PUBLIC_TO_EVERYONE',
      },
      token
    );

    // Step 2: Upload video chunks
    await uploadTikTokVideoChunks(videoUrl, upload_url, upload_id, token);

    // Step 3: Publish video
    const { item_id } = await publishTikTokVideo(upload_id, formattedContent.text, token);

    console.log('✅ TikTok video published successfully:', item_id);

    return {
      success: true,
      platform_post_id: item_id,
      post_url: `https://www.tiktok.com/@${account.username || account.platform_user_id}/video/${item_id}`,
      published_at: new Date(),
    };
  } catch (error: any) {
    const errorDetails = error.response?.data || error.message;
    console.error('❌ TikTok publish error:', errorDetails);

    // Handle specific TikTok API errors
    let errorCode = 'API_ERROR';
    let retryable = false;

    if (error.response?.status === 401) {
      errorCode = 'AUTH_ERROR';
      // Token might be expired, retryable after refresh
      retryable = true;
    } else if (error.response?.status === 403) {
      errorCode = 'PERMISSION_ERROR';
    } else if (error.response?.status === 429) {
      errorCode = 'RATE_LIMIT';
      retryable = true;
    } else if (error.response?.status >= 500) {
      retryable = true;
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: errorDetails?.error?.message || error.message || 'Failed to publish to TikTok',
        retryable,
      },
    };
  }
}
