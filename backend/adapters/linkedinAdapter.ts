/**
 * LinkedIn Adapter
 *
 * Publishes posts using LinkedIn's Posts API (v202410).
 * Reference: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *
 * Required OAuth Scope: w_member_social
 * Required LinkedIn App Product: "Share on LinkedIn"
 *
 * Setup:
 *   1. https://www.linkedin.com/developers/apps → your app → Products tab
 *   2. Add "Share on LinkedIn" product
 *   3. Verify w_member_social scope is approved
 */

import type { PublishResult } from './platformAdapterTypes';
// P3-A — reuse the EXISTING pipeline error vocabulary; no new codes.
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import { formatContentForPlatform } from '../utils/contentFormatter';
import { config } from '@/config';
import { outboundBreakerFor } from '../../lib/security/safeFetch';
import {
  getOrUploadLinkedInAsset,
  inferLinkedInMediaKind,
  type LinkedInMediaKind,
} from './linkedin/linkedinMediaUpload';
import { isLinkedInVersionSunsetSignal } from './linkedin/linkedinVersionSignal';

interface ScheduledPost {
  id: string;
  platform: string;
  content: string;
  title?: string;
  hashtags?: string[];
  media_urls?: string[];
  media_types?: string[];
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

/*
 * LinkedIn versioned API (YYYYMM). Each version is supported for a minimum of
 * one year and is then sunset; a sunset version fails every call with
 * "Requested version YYYYMM01 is not active", which stops publishing outright.
 *
 * Bumped 2026-09-16: 202507 was sunset (the 202508 sunset date was 2026-08-17).
 * 202608 is the latest published version, so it carries the longest runway —
 * LinkedIn supports it until at least August 2027.
 *
 * The SAME version string is sent by two other callers, and all three must be
 * bumped together or publishing half-breaks (text posts succeed, media fails):
 *   - backend/adapters/linkedin/linkedinMediaUpload.ts  (image/video upload)
 *   - backend/services/providerReconciliation/providers/linkedinReconciliation.ts
 */
const LINKEDIN_API_VERSION = '202608';

export async function publishToLinkedIn(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  if (config.USE_MOCK_PLATFORMS === true) {
    console.log('[linkedin] MOCK MODE: simulating post');
    return {
      success: true,
      platform_post_id: `mock_linkedin_${Date.now()}`,
      post_url: `https://www.linkedin.com/feed/update/urn:li:share:${Date.now()}`,
      published_at: new Date(),
    };
  }

  if (!account.platform_user_id) {
    return {
      success: false,
      error: {
        code: 'LINKEDIN_NO_USER_ID',
        message: 'LinkedIn account has no platform_user_id. Reconnect the account.',
        retryable: false,
      },
    };
  }

  const formatted = formatContentForPlatform(post.content, 'linkedin', {
    hashtags: post.hashtags,
    mediaUrls: post.media_urls,
  });

  if (formatted.warnings.length > 0) {
    console.warn('[linkedin] content formatting warnings:', formatted.warnings);
  }

  const authorUrn = `urn:li:person:${account.platform_user_id}`;

  // LinkedIn Posts API payload (replaces deprecated /v2/ugcPosts)
  const payload: Record<string, unknown> = {
    author: authorUrn,
    commentary: formatted.text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  // ── Media upload branch (feature-flagged) ─────────────────────────────
  //
  // LINKEDIN_MEDIA_UPLOAD_ENABLED=true activates the LinkedIn media pipeline:
  //   1. For each url in post.media_urls, upload (or reuse cached URN) to LinkedIn
  //   2. Attach the asset URN to the Posts API payload
  //   3. If ANY upload fails: return a structured failure WITHOUT publishing
  //      (so the post isn't sent as text-only with media silently dropped).
  //
  // Default off, and there is exactly ONE switch. An earlier revision of this
  // note said to "flip both flags together" with a static
  // ADAPTER_CAN_PUBLISH_MEDIA[linkedin] entry in publishReadinessValidator.ts.
  // That static entry no longer exists: adapterCanPublishMedia() special-cases
  // linkedin and reads LINKEDIN_MEDIA_UPLOAD_ENABLED directly, so this env var
  // opens the readiness guard AND this branch at once. An operator following
  // the old note would go looking for a second flag that is not there.
  //
  // It stays off until the upload pipeline has been validated against a real
  // LinkedIn account in non-prod. That validation has not happened; nothing in
  // this file can substitute for it.
  //
  // Per-node thread media: each thread child row publishes through its own
  // publishToLinkedIn call (the orchestrator passes per-row id; the adapter
  // sees that row's own media_urls). No per-thread coordination needed here.
  const linkedinMediaEnabled = String(process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED ?? 'false').toLowerCase() === 'true';
  const mediaUrls = Array.isArray(post.media_urls) ? post.media_urls.filter((u) => typeof u === 'string' && u.trim().length > 0) : [];
  const mediaTypes = Array.isArray(post.media_types) ? post.media_types : [];

  if (linkedinMediaEnabled && mediaUrls.length > 0) {
    // Upload each media url; aggregate URNs.
    const uploaded: Array<{ url: string; urn: string; kind: LinkedInMediaKind }> = [];
    for (let i = 0; i < mediaUrls.length; i++) {
      const url = mediaUrls[i];
      const mimeType = typeof mediaTypes[i] === 'string' ? mediaTypes[i] : undefined;
      const outcome = await getOrUploadLinkedInAsset({
        scheduledPostId: post.id,
        sourceUrl: url,
        mimeType,
        auth: { accessToken: token.access_token, authorUrn },
      });
      if (outcome.ok === false) {
        return {
          success: false,
          error: {
            code: outcome.error.code,
            message: outcome.error.message,
            retryable: outcome.error.retryable,
          },
        };
      }
      uploaded.push({ url, urn: outcome.result.assetUrn, kind: outcome.result.kind });
    }

    // Attach to the Posts API payload.
    // Single asset: content.media = { id: '<urn>', altText: null }
    // (Multi-image carousel and mixed image+video deferred — see module header.)
    if (uploaded.length === 1) {
      payload.content = { media: { id: uploaded[0].urn, altText: null } };
    } else {
      // Multi-image case (multiImage). Mixing image+video in one post is NOT
      // supported by LinkedIn Posts API — reject explicitly to surface the
      // limit rather than send a malformed payload.
      const allImages = uploaded.every((u) => u.kind === 'image');
      if (!allImages) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_MIXED_MEDIA_UNSUPPORTED',
            message: 'LinkedIn Posts API does not support mixing image and video in one post. Split into separate posts.',
            retryable: false,
          },
        };
      }
      payload.content = {
        multiImage: {
          images: uploaded.map((u) => ({ id: u.urn, altText: null })),
        },
      };
    }
  } else if (mediaUrls.length > 0 && !linkedinMediaEnabled) {
    // P3-A — HONEST FAILURE, not a silent strip.
    //
    // This row asked for media and this adapter cannot deliver it. Previously
    // we logged a warning and published TEXT ONLY, reporting success — so an
    // approved image campaign shipped as bare text and nothing downstream
    // could tell. A warning in a server log is not user-facing honesty.
    //
    // The publish-readiness guard (PUBLISH_GUARD_MODE=enforce, the default)
    // normally rejects this row before it reaches the adapter; this branch is
    // reachable when that guard is in `warn`/`off`. In those modes the correct
    // outcome is still a truthful failure, never materially different content
    // published as a success.
    //
    // Not retryable: retrying cannot change a capability that is switched off.
    // Resolution is operational — enable LINKEDIN_MEDIA_UPLOAD_ENABLED (which
    // now also opens the readiness guard, see publishReadinessValidator) or
    // remove the media from the post.
    console.warn('[linkedin] LINKEDIN_MEDIA_UPLOAD_ENABLED=false and row has', mediaUrls.length, 'media url(s) — refusing to publish as text-only');
    return {
      success: false,
      error: {
        code: PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED,
        message:
          `This post has ${mediaUrls.length} attached media item(s), but LinkedIn media upload is turned off, ` +
          `so publishing would have sent TEXT ONLY. Nothing was published. ` +
          `Enable LinkedIn media upload, or remove the media from this post.`,
        retryable: false,
      },
    };
  }

  console.log('[linkedin] publishing as author:', authorUrn, '| content length:', formatted.text.length);

  try {
    const response = await outboundBreakerFor('api.linkedin.com').call(() => fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(payload),
    }));

    const responseText = await response.text();
    console.log('[linkedin] API response:', response.status, responseText.slice(0, 300));

    if (!response.ok) {
      let errorBody: any = {};
      try { errorBody = JSON.parse(responseText); } catch { /* plain text */ }

      const status = response.status;
      const message = errorBody?.message || errorBody?.error || responseText || `HTTP ${status}`;

      // A sunset LinkedIn-Version is checked FIRST, before the credential
      // branches. It stops every LinkedIn call at once and has exactly one
      // fix (bump the pin), so it must not be misreported as an auth or a
      // generic API problem.
      //
      // It does not always arrive as HTTP 426: the 2026-09-16 outage
      // presented as the body message "Requested version 20250701 is not
      // active", which the status-only check missed — the row then failed as
      // LINKEDIN_API_ERROR and the one actionable diagnosis was lost. Match
      // the status OR the message. The message predicate is narrow enough
      // that it cannot capture unrelated 4xx responses.
      if (status === 426 || isLinkedInVersionSunsetSignal(message) || isLinkedInVersionSunsetSignal(responseText)) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_VERSION_EXPIRED',
            message: `LinkedIn API version ${LINKEDIN_API_VERSION} is no longer active (HTTP ${status}). Update LINKEDIN_API_VERSION in linkedinAdapter.ts, linkedin/linkedinMediaUpload.ts and providerReconciliation/providers/linkedinReconciliation.ts to a version released within the last 12 months. Detail: ${message}`,
            retryable: false,
          },
        };
      }

      if (status === 401) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_UNAUTHORIZED',
            message: `Token expired or invalid (401). Reconnect your LinkedIn account. Detail: ${message}`,
            retryable: false,
          },
        };
      }

      if (status === 403) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_FORBIDDEN',
            message: `Permission denied (403). Ensure "Share on LinkedIn" product is added to your LinkedIn App and w_member_social scope is approved. Detail: ${message}`,
            retryable: false,
          },
        };
      }

      if (status === 422) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_VALIDATION',
            message: `Invalid post data (422). Detail: ${message}`,
            retryable: false,
          },
        };
      }

      if (status === 429) {
        return {
          success: false,
          error: {
            code: 'LINKEDIN_RATE_LIMIT',
            message: 'LinkedIn rate limit hit. Will retry.',
            retryable: true,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'LINKEDIN_API_ERROR',
          message: `LinkedIn API error (${status}): ${message}`,
          retryable: status >= 500,
        },
      };
    }

    // Success: LinkedIn returns the post URN in the X-RestLi-Id header
    const postUrn = response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id') || '';
    // Fallback: try parsing body
    let platformPostId = postUrn;
    if (!platformPostId && responseText) {
      try {
        const body = JSON.parse(responseText);
        platformPostId = body.id || body.urn || '';
      } catch { /* ignore */ }
    }

    const postUrl = platformPostId
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(platformPostId)}`
      : `https://www.linkedin.com/in/${account.username || 'me'}/recent-activity/shares/`;

    console.log('[linkedin] post published:', platformPostId, postUrl);

    return {
      success: true,
      // Synthetic fallback: LinkedIn answered 2xx (the post IS live) but
      // returned neither an x-restli-id header nor an id in the body, so the
      // real URN was never captured. A non-empty id is still stored because
      // publishNowService uses platform_post_id as the re-publish guard —
      // storing '' here would let the row publish a SECOND time. It is
      // deliberately not URN-shaped, and linkedinReconciliation now refuses to
      // look up a non-URN id rather than reporting the resulting 404 as
      // 'no_match' (i.e. "deleted or never existed") about a live post.
      platform_post_id: platformPostId || `linkedin_${Date.now()}`,
      post_url: postUrl,
      published_at: new Date(),
    };
  } catch (err: any) {
    console.error('[linkedin] network error:', err?.message);
    return {
      success: false,
      error: {
        code: 'LINKEDIN_NETWORK_ERROR',
        message: err?.message || 'Network error calling LinkedIn API',
        retryable: true,
      },
    };
  }
}
