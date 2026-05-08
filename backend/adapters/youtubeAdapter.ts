/**
 * YouTube Adapter
 * 
 * Publishes videos to YouTube using the YouTube Data API v3.
 * 
 * IMPORTANT: YouTube posts are videos, not text posts!
 * This adapter uploads videos and creates video metadata.
 * 
 * API Documentation: https://developers.google.com/youtube/v3/docs/videos/insert
 * 
 * Required OAuth Scopes:
 * - https://www.googleapis.com/auth/youtube.upload
 * - https://www.googleapis.com/auth/youtube
 * 
 * To obtain credentials:
 * 1. Create Google Cloud project at https://console.cloud.google.com/
 * 2. Enable YouTube Data API v3
 * 3. Create OAuth 2.0 credentials (Web application)
 * 4. Configure redirect URI: {BASE_URL}/api/auth/youtube/callback
 * 5. Get Client ID and Client Secret
 * 
 * Environment Variables:
 * - YOUTUBE_CLIENT_ID
 * - YOUTUBE_CLIENT_SECRET
 * - USE_MOCK_PLATFORMS=true (for testing)
 * 
 * Note: YouTube videos require actual video file uploads.
 * For URL-based videos, you'll need to download and re-upload them.
 */

import axios from 'axios';
import type { PublishResult } from './platformAdapterTypes';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string; // Video description
  title?: string; // Video title (required)
  hashtags?: string[];
  media_urls?: string[]; // Video file URLs (required)
  scheduled_for: string;
}

interface SocialAccount {
  id: string;
  platform: string;
  platform_user_id: string; // YouTube Channel ID
  username?: string;
}

interface Token {
  access_token: string;
  token_type?: string;
}

async function downloadRemoteVideo(videoUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  contentLength: number;
}> {
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new Error('YouTube upload expects an HTTP(S) video URL');
  }

  const response = await axios.get<ArrayBuffer>(videoUrl, {
    responseType: 'arraybuffer',
    maxContentLength: 1024 * 1024 * 1024,
    maxBodyLength: 1024 * 1024 * 1024,
  });

  const buffer = Buffer.from(response.data);
  const rawContentType = response.headers['content-type'];
  return {
    buffer,
    contentType: typeof rawContentType === 'string' && rawContentType
      ? rawContentType
      : 'application/octet-stream',
    contentLength: buffer.byteLength,
  };
}

/**
 * Upload video file to YouTube
 * 
 * YouTube video upload uses resumable upload protocol:
 * 1. Initialize upload session (get upload URL)
 * 2. Upload video in chunks
 * 3. Finalize upload
 * 4. Create video resource with metadata
 */
async function uploadVideoToYouTube(
  videoUrl: string,
  title: string,
  description: string,
  tags: string[],
  channelId: string,
  token: Token
): Promise<string> {
  const { buffer, contentType, contentLength } = await downloadRemoteVideo(videoUrl);

  const videoMetadata = {
    snippet: {
      title,
      description,
      tags: tags.slice(0, 50), // YouTube max 50 tags
      categoryId: '22', // People & Blogs (default)
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: {
      privacyStatus: 'public', // or 'unlisted', 'private'
      selfDeclaredMadeForKids: false,
    },
  };

  const initiateResponse = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos',
    videoMetadata,
    {
      params: {
        uploadType: 'resumable',
        part: 'snippet,status',
      },
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(contentLength),
        'X-Upload-Content-Type': contentType,
      },
      validateStatus: () => true,
    }
  );

  const uploadUrl = initiateResponse.headers.location as string | undefined;
  if (!uploadUrl) {
    throw new Error(initiateResponse.data?.error?.message || 'Failed to initialize YouTube upload session');
  }

  const uploadResponse = await axios.put(uploadUrl, buffer, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Length': String(contentLength),
      'Content-Type': contentType,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  if (uploadResponse.status < 200 || uploadResponse.status >= 300 || !uploadResponse.data?.id) {
    throw new Error(uploadResponse.data?.error?.message || 'YouTube upload failed');
  }

  return String(uploadResponse.data.id);
}

/**
 * Alternative: Create YouTube post/video using existing video URL
 * (If video is already uploaded to YouTube)
 */
async function createYouTubeVideoFromUrl(
  videoId: string,
  title: string,
  description: string,
  token: Token
): Promise<{ id: string }> {
  // If video is already on YouTube, we just update metadata
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos`;
  
  const response = await axios.put(apiUrl, {
    id: videoId,
    snippet: {
      title: title,
      description: description,
    },
  }, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    params: {
      part: 'snippet',
    },
  });

  return response.data;
}

/**
 * Publish video to YouTube
 * 
 * YouTube posts are videos, so media_urls[0] must be a video file
 */
export async function publishToYouTube(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  // Use mock mode if enabled
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating YouTube video upload');
    return {
      success: true,
      platform_post_id: `mock_youtube_${Date.now()}`,
      post_url: `https://www.youtube.com/watch?v=mock_${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // YouTube requires video file
    if (!post.media_urls || post.media_urls.length === 0) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_NO_VIDEO',
          message: 'YouTube posts require a video file',
          retryable: false,
        },
      };
    }

    // YouTube requires title
    if (!post.title || post.title.trim().length === 0) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_NO_TITLE',
          message: 'YouTube videos require a title',
          retryable: false,
        },
      };
    }

    // Format content (description) automatically for YouTube
    const formatted = formatContentForPlatform(post.content, 'youtube', {
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    });

    // Log warnings
    if (formatted.warnings.length > 0) {
      console.warn('⚠️ YouTube content formatting warnings:', formatted.warnings);
    }

    // Build description
    let description = formatted.text;
    
    // Add hashtags to description (YouTube supports them)
    if (formatted.hashtags.length > 0) {
      description += '\n\n' + formatted.hashtags.join(' ');
    }

    // Extract tags (hashtags without # for YouTube)
    const tags = formatted.hashtags.map(tag => tag.replace('#', ''));

    // Build video title (max 100 chars)
    let videoTitle = post.title;
    if (videoTitle.length > 100) {
      videoTitle = videoTitle.substring(0, 97) + '...';
    }

    // Video metadata
    const videoMetadata = {
      snippet: {
        title: videoTitle,
        description: description.substring(0, 5000), // YouTube max 5000 chars
        tags: tags.slice(0, 50), // YouTube max 50 tags
        categoryId: '22', // People & Blogs (common category)
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public', // Options: public, unlisted, private
        selfDeclaredMadeForKids: false,
      },
    };

    // For now, we'll create a simplified upload flow
    // In production, implement full resumable upload protocol for video files
    // This requires:
    // 1. Download video from URL (if URL provided)
    // 2. Upload video in chunks using resumable upload
    // 3. Create video resource with metadata

    // Simplified approach: If video is already on YouTube (by URL/id), just update metadata
    const videoUrl = post.media_urls[0];
    const youtubeVideoIdMatch = videoUrl.match(/[?&]v=([^&]+)/); // Extract video ID from YouTube URL
    
    if (youtubeVideoIdMatch) {
      // Video already exists on YouTube, just update metadata
      const existingVideoId = youtubeVideoIdMatch[1];
      
      const updateUrl = 'https://www.googleapis.com/youtube/v3/videos';
      await axios.put(updateUrl, {
        id: existingVideoId,
        snippet: videoMetadata.snippet,
        status: videoMetadata.status,
      }, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        params: {
          part: 'snippet,status',
        },
      });

      const postUrl = `https://www.youtube.com/watch?v=${existingVideoId}`;
      
      console.log(`✅ YouTube video metadata updated: ${postUrl}`);
      
      return {
        success: true,
        platform_post_id: existingVideoId,
        post_url: postUrl,
        published_at: new Date(),
      };
    }

    const uploadedVideoId = await uploadVideoToYouTube(
      videoUrl,
      videoTitle,
      description.substring(0, 5000),
      tags,
      account.platform_user_id,
      token
    );

    return {
      success: true,
      platform_post_id: uploadedVideoId,
      post_url: `https://www.youtube.com/watch?v=${uploadedVideoId}`,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('YouTube API error:', error.response?.data || error.message);

    // Handle specific YouTube API errors
    if (error.response?.status === 401) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_UNAUTHORIZED',
          message: 'Token expired or invalid. Please reconnect YouTube account.',
          retryable: false,
        },
      };
    }

    if (error.response?.status === 403) {
      const errorData = error.response?.data?.error || {};
      return {
        success: false,
        error: {
          code: 'YOUTUBE_PERMISSION_DENIED',
          message: `Permission denied: ${errorData.message || 'Insufficient permissions'}. Check that you have youtube.upload scope.`,
          retryable: false,
        },
      };
    }

    if (error.response?.status === 429) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_RATE_LIMIT',
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true,
        },
      };
    }

    // Handle quota errors
    if (error.response?.status === 403 && error.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded') {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_QUOTA_EXCEEDED',
          message: 'YouTube API quota exceeded. Please try again tomorrow or upgrade your quota.',
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
          code: 'YOUTUBE_VALIDATION_ERROR',
          message: errorData.message || 'Invalid video content or metadata',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'YOUTUBE_API_ERROR',
        message: error.response?.data?.error?.message || error.message,
        retryable: true,
      },
    };
  }
}
