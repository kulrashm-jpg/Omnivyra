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
import type { PublishResult } from './platformAdapterTypes';
// Reuse the EXISTING pipeline error vocabulary (P3-A); no new media codes.
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';

/** Single Graph version for this adapter — see metaGraphApiVersionConsistency.test.ts. */
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

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

interface FacebookPage {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
}

type PageTarget =
  | { ok: true; pageId: string; pageAccessToken: string; pageName: string | null }
  | { ok: false; error: NonNullable<PublishResult['error']> };

/**
 * Resolve the Page, and the PAGE access token, to publish with.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Publishing to `/{page-id}/feed` requires a Page access token. This adapter
 * used `token.access_token` — the token stored by the Facebook OAuth callback,
 * which is a USER token — and used `account.platform_user_id` as the Page id,
 * although the callback stores `profile.id` from `GET /me`, i.e. the Facebook
 * USER id (pages/api/auth/facebook/callback.ts). So every publish addressed a
 * user node with a user token, which Graph has not accepted for feed
 * publishing since publish_actions was withdrawn.
 *
 * The correct flow already exists in this repo and is what the OAuth scopes are
 * requested for: `pages_show_list` + `pages_manage_posts` (see
 * pages/api/auth/facebook/index.ts, whose comment names /me/accounts), and
 * metaDerivedAccountsService already reads pages — with their per-Page
 * `access_token` — from `GET /v22.0/me/accounts?fields=id,name,access_token`.
 * The same call and the same field set are used here; nothing new is invented.
 *
 * Selection is by EXACT id match, and no match is an explicit failure. Guessing
 * a Page for the operator would publish to a destination nobody chose, which is
 * precisely the silent-wrong-target outcome this adapter must not have.
 *
 * HTTP failures are deliberately allowed to throw: the caller's existing error
 * ladder already classifies 401 / 403 / 429 / 400 from Graph, and duplicating
 * that here would let the two drift apart.
 */
async function resolvePageTarget(
  account: SocialAccount,
  token: Token,
): Promise<PageTarget> {
  const response = await axios.get(`${GRAPH_BASE}/me/accounts`, {
    params: {
      fields: 'id,name,access_token',
      access_token: token.access_token,
    },
  });

  const pages: FacebookPage[] = Array.isArray(response.data?.data) ? response.data.data : [];
  const storedId = String(account.platform_user_id ?? '');
  const match = pages.find((page) => String(page.id ?? '') === storedId && storedId.length > 0);

  const describePages = () =>
    pages.length === 0
      ? 'this login administers no Facebook Pages'
      : `available Pages: ${pages.map((p) => `${String(p.name ?? 'unnamed')} (${String(p.id ?? '?')})`).join(', ')}`;

  if (!match) {
    return {
      ok: false,
      error: {
        code: 'FACEBOOK_NO_PAGE_TARGET',
        message:
          `This Facebook connection is stored against "${storedId || '(none)'}", which is not one of the Pages ` +
          `this login can publish to — ${describePages()}. Facebook only allows publishing to a Page, using that ` +
          `Page's own access token. Reconnect the Facebook account, granting pages_show_list and ` +
          `pages_manage_posts, and select the Page you want to publish to. Nothing was published.`,
        retryable: false,
      },
    };
  }

  const pageAccessToken = typeof match.access_token === 'string' ? match.access_token.trim() : '';
  if (!pageAccessToken) {
    return {
      ok: false,
      error: {
        code: 'FACEBOOK_NO_PAGE_TOKEN',
        message:
          `Facebook returned Page "${String(match.name ?? storedId)}" without a Page access token, which means ` +
          `the connection is missing the pages_manage_posts / pages_show_list grant. Reconnect the Facebook ` +
          `account and approve those permissions. Nothing was published.`,
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    pageId: storedId,
    pageAccessToken,
    pageName: typeof match.name === 'string' ? match.name : null,
  };
}

/**
 * Does this URL look like an image / a video?
 *
 * Terminated with `(\?|#|$)` rather than `$`, matching the established pattern
 * in backend/adapters/xMedia.ts. The previous `$`-anchored form matched nothing
 * on a signed or cache-busted URL (`…/a.jpg?token=…`), which is the normal shape
 * of media URLs here — and an unmatched URL fell through BOTH branches, so the
 * media was dropped and the post went out as text with success reported.
 */
const IMAGE_URL = /\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i;
const VIDEO_URL = /\.(mp4|mov|avi|webm)(\?|#|$)/i;

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
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('🧪 MOCK MODE: Simulating Facebook post');
    return {
      success: true,
      platform_post_id: `mock_facebook_${Date.now()}`,
      post_url: `https://www.facebook.com/${account.platform_user_id}/posts/${Date.now()}`,
      published_at: new Date(),
    };
  }

  try {
    // Resolve the Page + its own access token BEFORE building anything. A
    // connection with no Page target cannot publish at all, and must say so
    // rather than posting at a user node with a user token.
    const target = await resolvePageTarget(account, token);
    if (target.ok === false) {
      console.warn('[facebook] no publishable Page target:', target.error.code);
      return { success: false, error: target.error };
    }

    const pageId = target.pageId;
    const apiUrl = `${GRAPH_BASE}/${pageId}/feed`;

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

    // Build payload. The PAGE token is what authorises a Page feed write —
    // the stored user token cannot.
    const payload: any = {
      message: message,
      access_token: target.pageAccessToken,
    };

    // Handle media.
    //
    // P3-A invariant: a post that asked for media must never be reported as a
    // successful text-only publication. Two ways that used to happen here, both
    // ending in `success: true` with the media gone and only the message sent:
    //
    //   1. the URL did not match the `$`-anchored extension tests (any signed
    //      or cache-busted media URL), so NEITHER branch attached anything;
    //   2. the post carried several media items, of which only the first was
    //      ever attached.
    //
    // Both are now truthful failures, using the SAME MEDIA_WOULD_BE_STRIPPED
    // code LinkedIn and X already return. Not retryable: neither an unsupported
    // file type nor a multi-item post becomes publishable by trying again.
    const requestedMedia = Array.isArray(post.media_urls)
      ? post.media_urls.filter((u) => typeof u === 'string' && u.trim().length > 0)
      : [];

    if (requestedMedia.length > 0) {
      const firstMedia = requestedMedia[0];
      const isVideo = VIDEO_URL.test(firstMedia);
      const isImage = IMAGE_URL.test(firstMedia);

      if (requestedMedia.length > 1) {
        return {
          success: false,
          error: {
            code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
            message:
              `This post has ${requestedMedia.length} attached media items, but this Facebook adapter can attach ` +
              `only one to a feed post, so publishing would have dropped ${requestedMedia.length - 1} of them. ` +
              `Nothing was published. Split it into separate posts, or reduce it to a single media item.`,
            retryable: false,
          },
        };
      }

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
      } else {
        return {
          success: false,
          error: {
            code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
            message:
              `This post has an attached media item that Facebook publishing does not recognise as an image ` +
              `(jpg/jpeg/png/gif/webp) or a video (mp4/mov/avi/webm), so publishing would have sent TEXT ONLY. ` +
              `Nothing was published.`,
            retryable: false,
          },
        };
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
