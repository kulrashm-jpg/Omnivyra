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
import { generateBrandedYouTubeThumbnail, setYouTubeThumbnail } from './youtubeThumbnail';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string; // Video description
  title?: string; // Video title (required)
  hashtags?: string[];
  media_urls?: string[]; // Video file URLs (required)
  scheduled_for: string;
  youtube_privacy?: string | null; // 'public' | 'unlisted' | 'private' — per-video visibility
}

/** Coerce a stored visibility value into a valid YouTube privacyStatus. */
function resolveYouTubeVisibility(value: unknown): YouTubeVisibility {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'unlisted' || v === 'private' ? v : 'public';
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
export type YouTubeVisibility = 'public' | 'unlisted' | 'private';

/**
 * Map the marketing content to a YouTube video category id (default 22, People
 * & Blogs). Keyword-driven from the title/description — leverages the generated
 * marketing copy instead of hardcoding a single category.
 */
export function resolveYouTubeCategoryId(text: string): string {
  const t = String(text || '').toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => t.includes(w));
  if (has('how to', 'how-to', 'tutorial', 'guide', 'learn', 'course', 'lesson', 'training', 'education', 'explain')) return '27'; // Education
  if (has('software', ' app', 'ai ', 'tech', 'saas', 'developer', 'coding', 'data', 'automation', 'gadget', 'platform')) return '28'; // Science & Technology
  if (has('news', 'announce', 'launch', 'report', 'update')) return '25'; // News & Politics
  if (has('entertain', 'comedy', 'funny', 'story time')) return '24'; // Entertainment
  return '22'; // People & Blogs — marketing/business/brand content fits here on YT
}

/** Build YouTube tags from hashtags + salient title words (deduped, max 50). */
export function buildYouTubeTags(hashtags: string[] | undefined, title: string): string[] {
  const fromHashtags = (hashtags || []).map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean);
  const fromTitle = String(title || '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...fromHashtags, ...fromTitle]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
    if (out.length >= 50) break;
  }
  return out;
}

async function uploadVideoToYouTube(
  videoUrl: string,
  title: string,
  description: string,
  tags: string[],
  channelId: string,
  token: Token,
  categoryId: string = '22',
  privacyStatus: YouTubeVisibility = 'public',
): Promise<string> {
  const { buffer, contentType, contentLength } = await downloadRemoteVideo(videoUrl);

  const videoMetadata = {
    snippet: {
      title,
      description,
      tags: tags.slice(0, 50), // YouTube max 50 tags
      categoryId,
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: {
      privacyStatus,
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
/**
 * Split a YouTube variant into an SEO title + structured description. The
 * variant prompt emits "TITLE\n\nDESCRIPTION"; the first line is treated as the
 * title only when it's short and followed by a body. Falls back to the post's
 * own title (and the whole content as the description) otherwise.
 */
export function splitYouTubeContent(raw: string, fallbackTitle: string): { title: string; description: string } {
  const text = String(raw || '').trim();
  const fallback = String(fallbackTitle || '').trim();
  const nlIdx = text.indexOf('\n');
  if (nlIdx > 0) {
    const firstLine = text.slice(0, nlIdx).trim();
    const rest = text.slice(nlIdx).replace(/^\s+/, '');
    if (firstLine.length > 0 && firstLine.length <= 100 && rest.length > 0) {
      return { title: firstLine.replace(/^#+\s*/, ''), description: rest };
    }
  }
  return { title: fallback || text.slice(0, 100), description: text };
}

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
    // Round-3 Phase 3: media-required check removed. Centralized validator in
    // publishToPlatform rejects no-media payloads upstream as MEDIA_REQUIRED.

    // Split the YouTube variant into an SEO title + structured description
    // (the variant prompt emits "TITLE\n\nDESCRIPTION"; falls back to post.title).
    const ytParsed = splitYouTubeContent(post.content, post.title || '');

    // YouTube requires a title
    if (!ytParsed.title || ytParsed.title.trim().length === 0) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_NO_TITLE',
          message: 'YouTube videos require a title',
          retryable: false,
        },
      };
    }

    // Format the DESCRIPTION portion automatically for YouTube
    const formatted = formatContentForPlatform(ytParsed.description, 'youtube', {
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

    // Build video title (YouTube max 100 chars) from the parsed SEO title
    let videoTitle = ytParsed.title;
    if (videoTitle.length > 100) {
      videoTitle = videoTitle.substring(0, 97) + '...';
    }

    // Derive YouTube fields from the marketing content instead of hardcoding:
    // a keyword-mapped category, and richer tags (hashtags + title keywords).
    const categoryId = resolveYouTubeCategoryId(`${videoTitle} ${formatted.text}`);
    const tags = buildYouTubeTags(post.hashtags, videoTitle);
    // Per-video visibility from the user's choice (falls back to 'public').
    const privacyStatus: YouTubeVisibility = resolveYouTubeVisibility(post.youtube_privacy);

    // Video metadata
    const videoMetadata = {
      snippet: {
        title: videoTitle,
        description: description.substring(0, 5000), // YouTube max 5000 chars
        tags: tags.slice(0, 50), // YouTube max 50 tags
        categoryId,
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus,
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
      token,
      categoryId,
      privacyStatus,
    );

    // Best-effort branded custom thumbnail — deterministic (clean title text),
    // and fully non-fatal: any failure leaves YouTube's auto thumbnail.
    try {
      const thumb = await generateBrandedYouTubeThumbnail(videoTitle, { companyName: account.username });
      if (thumb) await setYouTubeThumbnail(uploadedVideoId, thumb, token.access_token);
    } catch { /* non-fatal — video already published */ }

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
