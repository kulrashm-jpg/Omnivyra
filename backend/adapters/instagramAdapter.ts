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
import type { PublishResult } from './platformAdapterTypes';
// Reuse the EXISTING pipeline error vocabulary (P3-A); no new media codes.
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';
import { generateHostedBrandedCover, resolveCoverBrand } from './mediaCover';

/**
 * Is this URL a video?
 *
 * Terminated with `(\?|#|$)` rather than `$`, matching backend/adapters/xMedia.ts.
 * With the `$`-anchored form a signed or cache-busted Reel URL
 * (`…/clip.mp4?token=…`) was not recognised as video, so it was sent to the
 * image container as `image_url: <an mp4>`. Graph rejects that with a 400,
 * which this adapter reports as INSTAGRAM_VALIDATION_ERROR, retryable: false —
 * a perfectly valid Reel died permanently under "Invalid post content or media".
 */
const VIDEO_URL = /\.(mp4|mov|avi|webm)(\?|#|$)/i;

interface ScheduledPost {
  id: string;
  platform: string;
  content: string;
  title?: string;
  hashtags?: string[];
  media_urls?: string[];
  scheduled_for: string;
  publish_settings?: Record<string, any> | null; // generic per-platform options
}

interface InstagramReelOptions {
  coverUrl?: string;        // custom cover image URL (branded/user)
  thumbOffsetMs?: number;   // cover frame offset (ms) when no cover image
  shareToFeed: boolean;     // also show the Reel in the main feed
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

// Graph version is pinned here (and only here) so the publish path cannot drift
// between container creation, status polling and publish. v22.0 is valid until
// 2027-05-20.
const GRAPH_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * A container never became publishable. Carries its own publish-result code so
 * the classifier does not have to re-derive intent from a message string: a
 * container Instagram REJECTED must not be retried, a container that was still
 * processing when the budget ran out may be.
 */
class InstagramContainerError extends Error {
  constructor(
    message: string,
    readonly publishCode: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'InstagramContainerError';
  }
}

/**
 * Poll a media container until Instagram reports it is publishable.
 *
 * Meta requires `status_code=FINISHED` before `media_publish`, and documents
 * the full status vocabulary as EXPIRED | ERROR | FINISHED | IN_PROGRESS |
 * PUBLISHED, recommending a poll rather than an immediate publish. This runs
 * for BOTH images and videos: an image container is usually ready at once, but
 * "usually" is not the contract, and publishing an unfinished container is the
 * failure this guards.
 *
 * Status is read BEFORE the first sleep so a ready container costs no delay.
 */
async function waitForContainerReady(
  containerId: string,
  token: Token,
  opts: { intervalMs: number; maxWaitMs: number; kind: 'Video' | 'Image' },
): Promise<void> {
  const deadline = Date.now() + opts.maxWaitMs;
  let lastStatus = 'IN_PROGRESS';

  for (;;) {
    const statusResponse = await axios.get(`${GRAPH_BASE}/${containerId}`, {
      params: {
        fields: 'status_code',
        access_token: token.access_token,
      },
    });
    const raw = statusResponse.data?.status_code;
    lastStatus = raw === undefined || raw === null || raw === '' ? 'missing' : String(raw);

    // PUBLISHED can only appear on a retry of an already-published container;
    // treating it as ready keeps a retry idempotent instead of stalling.
    if (lastStatus === 'FINISHED' || lastStatus === 'PUBLISHED') return;
    if (lastStatus === 'ERROR') {
      throw new InstagramContainerError(
        `${opts.kind} processing failed on Instagram (container status ERROR). ` +
          'Check the file format, duration and aspect ratio against Instagram’s media specifications.',
        'INSTAGRAM_MEDIA_REJECTED',
        false,
      );
    }
    if (lastStatus === 'EXPIRED') {
      throw new InstagramContainerError(
        'The Instagram media container expired before it could be published (container status EXPIRED; ' +
          'containers expire after 24 hours).',
        'INSTAGRAM_CONTAINER_EXPIRED',
        false,
      );
    }
    // Only IN_PROGRESS is worth waiting on. A missing or unrecognised
    // status_code is named as such — never reported as "took too long", which
    // sends whoever reads it looking for a slow transcode that never happened.
    if (lastStatus !== 'IN_PROGRESS') {
      throw new InstagramContainerError(
        `Instagram stopped processing the media with status_code=${lastStatus}.`,
        'INSTAGRAM_API_ERROR',
        true,
      );
    }
    if (Date.now() + opts.intervalMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }

  throw new InstagramContainerError(
    `Instagram did not finish processing the media in time (last status: ${lastStatus}).`,
    'INSTAGRAM_PROCESSING_TIMEOUT',
    true,
  );
}

/**
 * Best-effort permalink lookup for a just-published media.
 *
 * `media_publish` returns a NUMERIC media id, not the shortcode Instagram uses
 * in `instagram.com/p/<shortcode>/`, so a URL built from that id 404s. The
 * permalink is only obtainable by asking for it. Non-fatal: the post is already
 * live, so a failure here returns undefined rather than failing the publish.
 */
async function fetchMediaPermalink(mediaId: string, token: Token): Promise<string | undefined> {
  try {
    const response = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
      params: {
        fields: 'permalink',
        access_token: token.access_token,
      },
    });
    const permalink = response.data?.permalink;
    return typeof permalink === 'string' && permalink.trim() ? permalink.trim() : undefined;
  } catch {
    return undefined;
  }
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
  // Step 1: Create media container for image. `media_type` is deliberately
  // omitted: Meta's reference defines it only for CAROUSEL / REELS / STORIES —
  // an image container is the default and there is no `IMAGE` value.
  const containerUrl = `${GRAPH_BASE}/${instagramAccountId}/media`;

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
 * Returns the container id. The caller polls it to FINISHED before publishing
 * (see waitForContainerReady) — the async processing wait is NOT optional for
 * video.
 */
async function uploadVideoToInstagram(
  videoUrl: string,
  caption: string,
  instagramAccountId: string,
  token: Token,
  options: InstagramReelOptions,
): Promise<{ container_id: string }> {
  // Step 1: Create media container for video (Reel), with cover + feed options.
  const containerUrl = `${GRAPH_BASE}/${instagramAccountId}/media`;

  const containerResponse = await axios.post(containerUrl, {
    // REELS is the only video media_type Meta's current reference defines for
    // the feed — the old `VIDEO` value is gone, so do not "restore" it.
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption,
    share_to_feed: options.shareToFeed,
    // A custom cover image wins; otherwise pick a frame offset if provided.
    ...(options.coverUrl ? { cover_url: options.coverUrl } : {}),
    ...(!options.coverUrl && Number.isFinite(options.thumbOffsetMs)
      ? { thumb_offset: Math.max(0, Math.trunc(options.thumbOffsetMs as number)) }
      : {}),
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
 * Publish media container to Instagram
 */
async function publishInstagramContainer(
  containerId: string,
  instagramAccountId: string,
  token: Token
): Promise<{ id: string }> {
  const publishUrl = `${GRAPH_BASE}/${instagramAccountId}/media_publish`;

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
    // Round-3 Phase 3: the media-required POLICY lives upstream and stays
    // there. Centralized validatePlatformContentCompatibility (called from
    // publishToPlatform — the sole entry point to this adapter, and from
    // publishNowService) rejects no-media payloads as MEDIA_REQUIRED, and the
    // registry is the single authority for platform-capability rules; the
    // centralization invariant in
    // backend/tests/unit/platformCapability.centralization.test.ts forbids a
    // second copy of the rule here.
    //
    // This normalisation is NOT that rule — it only stops `post.media_urls`
    // being read off `undefined`, which used to throw a TypeError into the
    // catch-all and be reported as a RETRYABLE INSTAGRAM_API_ERROR. An empty
    // list now reaches Graph and comes back as a non-retryable validation
    // error instead of a retry loop.
    const mediaUrls = Array.isArray(post.media_urls)
      ? post.media_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      : [];

    // Format content automatically for Instagram
    const formatted = formatContentForPlatform(post.content, 'instagram', {
      hashtags: post.hashtags,
      mediaUrls,
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

    const requestedMedia = mediaUrls;

    // P3-A invariant, applied to the carousel case. The capability registry
    // lists 'carousel' for Instagram, so a multi-image post reaches this
    // adapter — and this adapter builds ONE container from media_urls[0] and
    // publishes it, reporting success. A three-image carousel therefore
    // shipped as a single image and nothing downstream could tell.
    //
    // A real carousel needs a different container flow (per-child containers
    // collected into a CAROUSEL parent), which is not implemented here, so the
    // honest outcome is a refusal that says so — the same
    // MEDIA_WOULD_BE_STRIPPED code LinkedIn, X and Facebook already return.
    // Not retryable: retrying cannot add a flow that does not exist.
    if (requestedMedia.length > 1) {
      return {
        success: false,
        error: {
          code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
          message:
            `This post has ${requestedMedia.length} attached media items, but Instagram carousel publishing is ` +
            `not implemented in this adapter — publishing would have posted only the first and dropped ` +
            `${requestedMedia.length - 1}. Nothing was published. Split it into separate posts, or reduce it ` +
            `to a single image or video.`,
          retryable: false,
        },
      };
    }

    // Determine media type (assume first media URL determines type)
    const firstMediaUrl = mediaUrls[0];
    const isVideo = VIDEO_URL.test(String(firstMediaUrl));

    // Upload media and get container ID
    if (isVideo) {
      // Reel options from publish_settings.instagram: cover mode
      // (branded | frame | auto), cover frame time, share-to-feed.
      const igSettings = (post.publish_settings && typeof post.publish_settings === 'object'
        ? (post.publish_settings as any).instagram : null) || {};
      const coverMode = String(igSettings.cover ?? '').toLowerCase();
      const coverTimeMs = Number(igSettings.cover_time_ms);
      let coverUrl: string | undefined;
      if (coverMode === 'branded') {
        // Deterministic branded cover, hosted publicly. Non-fatal — falls back
        // to a frame / auto cover if generation or hosting fails.
        const brand = await resolveCoverBrand((account as { company_id?: unknown }).company_id, account.username);
        const generated = await generateHostedBrandedCover(post.title || caption, brand);
        if (generated) coverUrl = generated;
      } else if (typeof igSettings.cover_url === 'string' && igSettings.cover_url.trim()) {
        coverUrl = igSettings.cover_url.trim();
      }
      // Video upload (requires processing time)
      const result = await uploadVideoToInstagram(
        firstMediaUrl,
        caption,
        instagramAccountId,
        token,
        {
          coverUrl,
          thumbOffsetMs: Number.isFinite(coverTimeMs) ? coverTimeMs : undefined,
          shareToFeed: igSettings.share_to_feed !== false, // default: also share to feed
        },
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

    // Instagram requires status_code=FINISHED before media_publish. Video
    // containers take the documented minutes; image containers are normally
    // instant, so they get a short, fast poll rather than the video budget.
    await waitForContainerReady(
      containerId,
      token,
      isVideo
        ? { intervalMs: 10_000, maxWaitMs: 300_000, kind: 'Video' }
        : { intervalMs: 2_000, maxWaitMs: 60_000, kind: 'Image' },
    );

    // Publish the container
    const published = await publishInstagramContainer(
      containerId,
      instagramAccountId,
      token
    );

    // media_publish returns a NUMERIC media id. `instagram.com/p/<id>/` is not
    // a real permalink — the shortcode is different — so ask Instagram for the
    // permalink instead of fabricating one. Omitted rather than faked if the
    // lookup fails; post_url is optional on PublishResult.
    const postUrl = await fetchMediaPermalink(published.id, token);

    console.log(`✅ Instagram post published: ${postUrl ?? published.id}`);

    return {
      success: true,
      platform_post_id: published.id,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (error: any) {
    console.error('Instagram API error:', error.response?.data || error.message);
    return classifyInstagramPublishError(error);
  }
}

/** Graph auth error codes that mean "the stored credential is dead". */
const GRAPH_AUTH_CODES = new Set([102, 190]);
/** Graph subcodes for expired / invalidated sessions under code 190. */
const GRAPH_EXPIRED_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
/** Graph throttling codes, plus 9 = Instagram publishing limit reached. */
const GRAPH_THROTTLE_CODES = new Set([4, 9, 17, 32, 341, 613, 80007]);

/**
 * Map a Graph API failure onto a structured PublishResult error.
 *
 * Classification is driven by the Graph ERROR OBJECT first, and only then by
 * HTTP status. That ordering is the fix for the defect that hid the real cause
 * of Instagram's failures: Meta returns HTTP **400** with
 * `{ error: { type: 'OAuthException', code: 190 } }` for an expired token — it
 * does not return 401 — so a status-first classifier reported an expired
 * credential as "Invalid post content or media" and never told the operator to
 * reconnect. Likewise a throttle arrives as 400/code 4|9|17|32|613, not 429,
 * and was being marked non-retryable. The same 400+OAuthException shape is
 * already documented in the Instagram reconciliation lookup
 * (backend/services/providerReconciliation/providers/instagramReconciliation.ts:79).
 */
export function classifyInstagramPublishError(error: any): PublishResult {
  if (error instanceof InstagramContainerError) {
    return {
      success: false,
      error: { code: error.publishCode, message: error.message, retryable: error.retryable },
    };
  }

  const status = error?.response?.status;
  const graphError = error?.response?.data?.error ?? {};
  const type = String(graphError.type ?? '');
  const code = Number(graphError.code ?? NaN);
  const subcode = Number(graphError.error_subcode ?? NaN);
  const providerMessage = typeof graphError.message === 'string' ? graphError.message : '';

  // 1. Dead credential → reconnect. Non-retryable: no amount of retrying
  //    revives a revoked or expired token; a human must re-authorise.
  const expiredSession = GRAPH_AUTH_CODES.has(code) || GRAPH_EXPIRED_SUBCODES.has(subcode);
  if (expiredSession || (type === 'OAuthException' && status === 401) || status === 401) {
    return {
      success: false,
      error: {
        code: 'INSTAGRAM_UNAUTHORIZED',
        message:
          'Your Instagram connection has expired or been revoked. Reconnect the account in ' +
          'Settings → Social Accounts (Instagram), approving the instagram_basic, ' +
          'instagram_content_publish and pages_read_engagement permissions.' +
          (providerMessage ? ` Instagram said: ${providerMessage}` : ''),
        retryable: false,
      },
    };
  }

  // 2. Missing permission / wrong account type. Code 10 and the 200-299 band
  //    are Graph's permission errors; they also arrive as 400, not 403.
  const permissionError = code === 10 || (code >= 200 && code <= 299);
  if (permissionError || status === 403) {
    return {
      success: false,
      error: {
        code: 'INSTAGRAM_PERMISSION_DENIED',
        message:
          `Instagram API error: ${providerMessage || 'Permission denied'}. Check that your account is ` +
          'a Business/Creator account and connected to a Facebook Page.',
        retryable: false,
      },
    };
  }

  // 3. Throttling and the 100-posts-per-24h publishing limit are transient.
  if (GRAPH_THROTTLE_CODES.has(code) || status === 429) {
    return {
      success: false,
      error: {
        code: 'INSTAGRAM_RATE_LIMIT',
        message:
          (code === 9
            ? 'Instagram publishing limit reached (100 API-published posts per 24 hours). '
            : 'Instagram rate limit exceeded. ') +
          'Please try again later.' +
          (providerMessage ? ` Instagram said: ${providerMessage}` : ''),
        retryable: true,
      },
    };
  }

  // 4. Genuine payload rejection (bad media, caption, aspect ratio, …).
  if (status === 400) {
    return {
      success: false,
      error: {
        code: 'INSTAGRAM_VALIDATION_ERROR',
        message: providerMessage || 'Invalid post content or media',
        retryable: false,
      },
    };
  }

  return {
    success: false,
    error: {
      code: 'INSTAGRAM_API_ERROR',
      message: providerMessage || error?.message || 'Instagram publish failed',
      retryable: true,
    },
  };
}
