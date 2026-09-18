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
import { resolveCoverBrand } from './mediaCover';

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

/**
 * Turn a YouTube response that axios did NOT throw on into an error that still
 * carries the provider status.
 *
 * The resumable-upload calls pass `validateStatus: () => true`, so axios never
 * throws and a failure was re-raised as a bare `new Error(message)`. That error
 * has no `.response`, and publishToYouTube classifies purely on
 * `error.response?.status` — so EVERY upload-path failure, including 401 auth,
 * 403 quota and 400 validation, collapsed into YOUTUBE_API_ERROR with
 * retryable: true. A revoked token was retried forever, and a quota exhaustion
 * could never reach its own branch.
 */
function youTubeResponseError(
  response: { status: number; data?: any },
  fallback: string,
): Error {
  const error = new Error(response.data?.error?.message || fallback) as Error & {
    response?: { status: number; data?: any };
  };
  error.response = { status: response.status, data: response.data };
  return error;
}

/**
 * Is this a YouTube Data API quota rejection?
 *
 * YouTube reports quota exhaustion as HTTP 403 carrying
 * `error.errors[].reason = 'quotaExceeded'` — the literal this adapter already
 * checked for. Matching /quota/i over the reported reasons is a superset of
 * that same literal; no reason string this repo has no evidence for is guessed
 * at here.
 */
function isYouTubeQuotaError(error: any): boolean {
  if (error?.response?.status !== 403) return false;
  const reasons = error?.response?.data?.error?.errors;
  if (!Array.isArray(reasons)) return false;
  return reasons.some((entry: any) => /quota/i.test(String(entry?.reason ?? '')));
}

/**
 * YouTube watch hosts. Deliberately an explicit allow list with no
 * bare-domain/subdomain matching, mirroring PLATFORM_VIDEO_HOSTS and
 * hostMatchesPlatform() in backend/services/mediaUploadValidationService.ts —
 * the service that already recognises a platform link in media_urls, and that
 * documents the same "only trust an explicit allow list to avoid false
 * positives" rule.
 *
 * youtu.be is intentionally NOT here: it carries the id in the path, not in a
 * `v` parameter, so it needs a different extraction than this branch performs.
 * A youtu.be link therefore still takes the upload path (and fails there),
 * exactly as it did before — no behaviour is changed for it either way.
 */
const YOUTUBE_WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * Is media_urls[0] a link to a video that is ALREADY on YouTube (so the publish
 * is a metadata update), or a video file to upload?
 *
 * This was `videoUrl.match(/[?&]v=([^&]+)/)` — the presence of a `v=` query
 * parameter ANYWHERE in the URL, with no check that the URL is a YouTube URL at
 * all. Its own comment said "Extract video ID from YouTube URL" while doing no
 * such thing. A perfectly ordinary cache-busted or versioned media file
 * (`https://cdn.example.com/clip.mp4?v=3`) therefore matched, and instead of
 * being uploaded it was treated as YouTube video id "3": the adapter PUT the
 * post's title, description and privacyStatus at a video the channel does not
 * own. The real video was never uploaded, and the row died with
 * YOUTUBE_PERMISSION_DENIED ("Check that you have youtube.upload scope"),
 * naming a scope that was never the problem.
 *
 * That query strings on media URLs are ordinary here is not hypothetical: the
 * Instagram adapter carries an incident note about `…/clip.mp4?token=…`, and
 * xMedia's type regexes are all terminated `(?|#|$)` for the same reason.
 */
export function extractExistingYouTubeVideoId(mediaUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(String(mediaUrl ?? ''));
  } catch {
    return null;
  }
  if (!YOUTUBE_WATCH_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const id = (parsed.searchParams.get('v') ?? '').trim();
  return id.length > 0 ? id : null;
}

async function downloadRemoteVideo(videoUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  contentLength: number;
}> {
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new Error('YouTube upload expects an HTTP(S) video URL');
  }

  // HARDEN-005: videoUrl is user-controlled media — block internal targets first.
  const { assertUrlSafe } = await import('../../lib/security/safeFetch');
  await assertUrlSafe(videoUrl);
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
    throw youTubeResponseError(initiateResponse, 'Failed to initialize YouTube upload session');
  }

  // ssrf-ok: uploadUrl returned by the YouTube resumable-upload API (trusted platform response)
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
    throw youTubeResponseError(uploadResponse, 'YouTube upload failed');
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
    // Only a genuine YouTube watch URL means "already on YouTube" — see
    // extractExistingYouTubeVideoId for what a bare `v=` match cost.
    const existingVideoId = extractExistingYouTubeVideoId(videoUrl);

    if (existingVideoId) {
      // Video already exists on YouTube, just update metadata
      
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
      const brand = await resolveCoverBrand((account as { company_id?: unknown }).company_id, account.username);
      const thumb = await generateBrandedYouTubeThumbnail(videoTitle, brand);
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

    // Quota is checked BEFORE the generic 403. YouTube reports quota
    // exhaustion as a 403, so the generic branch below used to return first and
    // the quota branch that came after it was unreachable dead code. The
    // consequences were both wrong: a temporary, self-healing condition was
    // reported as a permanent permission failure with retryable: false, and the
    // message sent the operator to check the youtube.upload scope when no scope
    // was missing.
    if (isYouTubeQuotaError(error)) {
      return {
        success: false,
        error: {
          code: 'YOUTUBE_QUOTA_EXCEEDED',
          message: 'YouTube API quota exceeded. The daily quota resets at midnight Pacific Time; retry after that, or request a quota increase.',
          retryable: true,
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
