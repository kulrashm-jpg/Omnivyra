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

// LinkedIn versioned API — update quarterly (YYYYMM format)
const LINKEDIN_API_VERSION = '202410';

export async function publishToLinkedIn(
  post: ScheduledPost,
  account: SocialAccount,
  token: Token
): Promise<PublishResult> {
  if (process.env.USE_MOCK_PLATFORMS === 'true') {
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

  console.log('[linkedin] publishing as author:', authorUrn, '| content length:', formatted.text.length);

  try {
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log('[linkedin] API response:', response.status, responseText.slice(0, 300));

    if (!response.ok) {
      let errorBody: any = {};
      try { errorBody = JSON.parse(responseText); } catch { /* plain text */ }

      const status = response.status;
      const message = errorBody?.message || errorBody?.error || responseText || `HTTP ${status}`;

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
