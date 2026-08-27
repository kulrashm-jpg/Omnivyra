import { ownedDbTable } from '../db/writeOwner';
/**
 * Engagement Ingestion Service
 *
 * Canonical service for fetching platform engagement (comments) and persisting
 * into post_comments. Uses the same credential system as publishing (tokenStore / social_accounts).
 * No Community AI, no scoring, no auto-actions — ingestion only.
 *
 * Fetches comments via platformAdapters when available; falls back to legacy direct fetchers.
 *
 * @see docs/CANONICAL-SOCIAL-PLATFORM-OPERATIONS-DESIGN.md
 */

import { supabase } from '../db/supabaseClient';
import { getScheduledPost } from '../db/queries';
import { getToken, isTokenExpiringSoon } from '../auth/tokenStore';
import { refreshPlatformToken } from '../auth/tokenRefresh';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { syncFromPostComments } from './engagementNormalizationService';
import { getPlatformAdapter } from './platformAdapters';
import { getPlatformCategory } from './platformRegistryService';
import {
  providerErrorFromResponse,
  isProviderRequestError,
  isAuthFailure,
  ProviderRequestError,
} from './engagement/providerRequestError';
import { buildXConversationSearchUrl } from './engagement/xReplyQuery';
import { markSocialAccountNeedsReauth } from '../auth/tokenStore';

/**
 * How far back scheduled ingestion looks for posts to poll. See the rationale
 * at the query site in `ingestRecentPublishedPosts`.
 */
export const INGEST_WINDOW_DAYS = 30;

export type IngestCommentRow = {
  scheduled_post_id: string;
  platform_comment_id: string;
  platform: string;
  author_name: string;
  author_username?: string | null;
  author_profile_url?: string | null;
  author_avatar_url?: string | null;
  content: string;
  platform_created_at?: string | null;
  like_count?: number;
  reply_count?: number;
};

// ---- Platform fetch (extracted from pages/api/social/comments.ts) ----

async function fetchLinkedInComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(
    `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(platformPostId)}/comments`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        // Required by LinkedIn's v2 Rest.li endpoints; was missing here too.
        'X-Restli-Protocol-Version': '2.0.0',
      },
    }
  );
  if (!response.ok) {
    throw await providerErrorFromResponse(response, { provider: 'linkedin', endpointCategory: 'comments' });
  }
  return response.json();
}

/**
 * Replies to an X post, via conversation search.
 *
 * NOT `/2/tweets/{id}/replies` — that endpoint does not exist, and the 404 it
 * returned was previously misread as a credential problem. See `xReplyQuery.ts`
 * for the 7-day recent-search limitation this inherits.
 */
async function fetchTwitterComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(buildXConversationSearchUrl('https://api.twitter.com/2', platformPostId), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw await providerErrorFromResponse(response, { provider: 'x', endpointCategory: 'replies' });
  }
  return response.json();
}

async function fetchFacebookComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(
    `https://graph.facebook.com/v22.0/${platformPostId}/comments`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Facebook comments fetch failed: ${response.statusText}`);
  }
  return response.json();
}

async function fetchInstagramComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(
    `https://graph.facebook.com/v22.0/${platformPostId}/comments`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Instagram comments fetch failed: ${response.statusText}`);
  }
  return response.json();
}

function fetchCommentsFromPlatform(
  platform: string,
  platformPostId: string,
  accessToken: string
): Promise<any> {
  const p = platform.toLowerCase().trim();
  if (p === 'linkedin') return fetchLinkedInComments(accessToken, platformPostId);
  if (p === 'twitter' || p === 'x') return fetchTwitterComments(accessToken, platformPostId);
  if (p === 'facebook') return fetchFacebookComments(accessToken, platformPostId);
  if (p === 'instagram') return fetchInstagramComments(accessToken, platformPostId);
  throw new Error(`Unsupported platform for comment fetch: ${platform}`);
}

/**
 * Fetch comments via platform adapter when available; fall back to the legacy
 * direct fetchers ONLY when the adapter could not attempt the call.
 *
 * The fallback exists to cover platforms with no adapter — not to retry a
 * request the provider already answered. Previously any adapter throw fell
 * through to the legacy fetcher, which re-issued the SAME request with the SAME
 * token: an expired credential therefore produced two guaranteed-failing
 * provider calls per post per cycle (observed as 88 provider errors for 44
 * attempts). A provider that has already said 401 or 404 will say it again.
 */
async function fetchCommentsWithAdapterFallback(
  platform: string,
  platformPostId: string,
  accessToken: string
): Promise<any> {
  const adapter = getPlatformAdapter(platform);
  if (adapter) {
    try {
      return await adapter.fetchComments({ platformPostId, accessToken });
    } catch (e: any) {
      // A real provider response — the request was made and answered. Retrying
      // it through the legacy path would only duplicate the failure.
      if (isProviderRequestError(e)) throw e;
      // Adapter could not attempt the call (unsupported operation, adapter
      // defect). The legacy fetcher is a genuine alternative here.
      console.warn('[engagementIngestion] adapter could not attempt fetch, using legacy path', {
        platform,
        reason: e?.message ?? 'unknown',
      });
    }
  }
  return fetchCommentsFromPlatform(platform, platformPostId, accessToken);
}

// ---- Normalize raw API response to IngestCommentRow[] ----

function normalizeLinkedInComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const elements = raw?.elements ?? raw?.data ?? [];
  if (!Array.isArray(elements)) return [];
  return elements.map((c: any) => {
    const id = c.id ?? c.comment ?? c.$URN ?? String(c.actor?.split?.(':').pop() ?? '');
    const commentId = typeof id === 'string' ? id.replace(/^urn:li:comment:/i, '') : String(id);
    const message = c.message?.text ?? c.commentary ?? c.message ?? c.text ?? '';
    const author = c.actor?.name ?? c.creator?.name ?? 'Unknown';
    const createdAt = c.created?.time ?? c.createdAt ?? c.created_at ?? null;
    return {
      scheduled_post_id: scheduledPostId,
      platform_comment_id: commentId || `li_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      platform,
      author_name: typeof author === 'string' ? author.slice(0, 255) : 'Unknown',
      author_username: c.actor?.username ?? null,
      author_profile_url: c.actor?.profileUrl ?? null,
      author_avatar_url: null,
      content: typeof message === 'string' ? message : JSON.stringify(message) || '',
      platform_created_at: createdAt ? new Date(createdAt).toISOString() : null,
      like_count: typeof c.likesSummary?.totalLikes === 'number' ? c.likesSummary.totalLikes : 0,
      reply_count: typeof c.commentsSummary?.totalFirstLevelComments === 'number' ? c.commentsSummary.totalFirstLevelComments : 0,
    };
  }).filter((r: IngestCommentRow) => r.platform_comment_id && r.content !== undefined);
}

function normalizeTwitterComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const data = raw?.data ?? [];
  if (!Array.isArray(data)) return [];
  return data.map((c: any) => {
    const id = c.id ?? '';
    const text = c.text ?? c.message ?? '';
    const author = c.author_id ?? c.username ?? 'Unknown';
    const createdAt = c.created_at ?? null;
    return {
      scheduled_post_id: scheduledPostId,
      platform_comment_id: String(id),
      platform,
      author_name: typeof author === 'string' ? author.slice(0, 255) : 'Unknown',
      author_username: c.username ?? author ?? null,
      author_profile_url: null,
      author_avatar_url: null,
      content: typeof text === 'string' ? text : JSON.stringify(text) || '',
      platform_created_at: createdAt ? new Date(createdAt).toISOString() : null,
      like_count: 0,
      reply_count: 0,
    };
  }).filter((r: IngestCommentRow) => r.platform_comment_id && r.content !== undefined);
}

/**
 * Facebook Graph API comment shape:
 *   { data: [{ id, message, from: { id, name, username, profile_url }, created_time, like_count, comment_count }] }
 *
 * Facebook's `from` block includes both display name and username. `like_count`
 * and `comment_count` are the documented fields.
 */
function normalizeFacebookComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const data = raw?.data ?? [];
  if (!Array.isArray(data)) return [];
  return data.map((c: any) => {
    const id = c.id ?? '';
    const message = c.message ?? c.text ?? '';
    const from = c.from ?? {};
    const name = from.name ?? 'Unknown';
    const createdAt = c.created_time ?? c.created_at ?? null;
    return {
      scheduled_post_id: scheduledPostId,
      platform_comment_id: String(id),
      platform,
      author_name: typeof name === 'string' ? name.slice(0, 255) : 'Unknown',
      author_username: from.username ?? null,
      author_profile_url: from.profile_url ?? null,
      author_avatar_url: null,
      content: typeof message === 'string' ? message : JSON.stringify(message) || '',
      platform_created_at: createdAt ? new Date(createdAt).toISOString() : null,
      like_count: typeof c.like_count === 'number' ? c.like_count : 0,
      reply_count: typeof c.comment_count === 'number' ? c.comment_count : 0,
    };
  }).filter((r: IngestCommentRow) => r.platform_comment_id && r.content !== undefined);
}

/**
 * Instagram Graph API comment shape (differs from Facebook):
 *   { data: [{ id, text, username, timestamp, like_count, replies: { data: [...] } }] }
 *
 * Notes:
 *   - Instagram uses `text` (not `message`).
 *   - `username` is top-level, not nested in a `from` block.
 *   - `timestamp` instead of `created_time`.
 *   - Replies are a nested `replies.data[]`, not a scalar `comment_count`.
 */
function normalizeInstagramComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const data = raw?.data ?? [];
  if (!Array.isArray(data)) return [];
  return data.map((c: any) => {
    const id = c.id ?? '';
    const text = c.text ?? c.message ?? '';
    const username = typeof c.username === 'string' ? c.username : null;
    const createdAt = c.timestamp ?? c.created_time ?? null;
    const replyCount = Array.isArray(c?.replies?.data)
      ? c.replies.data.length
      : typeof c.reply_count === 'number' ? c.reply_count : 0;
    return {
      scheduled_post_id: scheduledPostId,
      platform_comment_id: String(id),
      platform,
      author_name: username ?? 'Unknown',
      author_username: username,
      author_profile_url: username ? `https://www.instagram.com/${username}` : null,
      author_avatar_url: null,
      content: typeof text === 'string' ? text : JSON.stringify(text) || '',
      platform_created_at: createdAt ? new Date(createdAt).toISOString() : null,
      like_count: typeof c.like_count === 'number' ? c.like_count : 0,
      reply_count: replyCount,
    };
  }).filter((r: IngestCommentRow) => r.platform_comment_id && r.content !== undefined);
}

function normalizeYouTubeComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const items = raw?.items ?? [];
  if (!Array.isArray(items)) return [];
  return items.map((item: any) => {
    const snippet = item?.snippet?.topLevelComment?.snippet ?? item?.snippet ?? {};
    const id = item?.id ?? snippet?.id ?? '';
    const text = snippet?.textDisplay ?? snippet?.textOriginal ?? snippet?.authorDisplayName ?? '';
    const author = snippet?.authorDisplayName ?? 'Unknown';
    const createdAt = snippet?.publishedAt ?? snippet?.updatedAt ?? null;
    return {
      scheduled_post_id: scheduledPostId,
      platform_comment_id: String(id),
      platform,
      author_name: typeof author === 'string' ? author.slice(0, 255) : 'Unknown',
      author_username: snippet?.authorChannelId?.value ?? null,
      author_profile_url: null,
      author_avatar_url: snippet?.authorProfileImageUrl ?? null,
      content: typeof text === 'string' ? text : JSON.stringify(text) || '',
      platform_created_at: createdAt ? new Date(createdAt).toISOString() : null,
      like_count: typeof snippet?.likeCount === 'number' ? snippet.likeCount : 0,
      reply_count: typeof snippet?.totalReplyCount === 'number' ? snippet.totalReplyCount : 0,
    };
  }).filter((r: IngestCommentRow) => r.platform_comment_id && r.content !== undefined);
}

function normalizeRedditComments(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const arr = Array.isArray(raw) ? raw : [];
  const commentsArray = arr.length > 1 ? arr[1] : arr[0] ?? [];
  const children = commentsArray?.data?.children ?? commentsArray ?? [];
  if (!Array.isArray(children)) return [];
  return children
    .map((child: any) => {
      const d = child?.data ?? child;
      if (!d || d.kind === 'more') return null;
      const id = d.id ?? '';
      const body = d.body ?? d.selftext ?? '';
      const author = d.author ?? 'Unknown';
      const createdAt = d.created ? new Date(d.created * 1000).toISOString() : null;
      return {
        scheduled_post_id: scheduledPostId,
        platform_comment_id: String(id),
        platform,
        author_name: typeof author === 'string' ? author.slice(0, 255) : 'Unknown',
        author_username: author ?? null,
        author_profile_url: null,
        author_avatar_url: null,
        content: typeof body === 'string' ? body : JSON.stringify(body) || '',
        platform_created_at: createdAt,
        like_count: typeof d.ups === 'number' ? d.ups : 0,
        reply_count: typeof d.replies === 'object' ? (d.replies?.data?.children?.length ?? 0) : 0,
      };
    })
    .filter((r: IngestCommentRow | null): r is IngestCommentRow => r !== null && r.platform_comment_id && r.content !== undefined);
}

function normalizeCommentsForPlatform(
  scheduledPostId: string,
  platform: string,
  raw: any
): IngestCommentRow[] {
  const p = platform.toLowerCase().trim();
  if (p === 'linkedin') return normalizeLinkedInComments(scheduledPostId, platform, raw);
  if (p === 'twitter' || p === 'x') return normalizeTwitterComments(scheduledPostId, platform, raw);
  if (p === 'facebook') return normalizeFacebookComments(scheduledPostId, platform, raw);
  if (p === 'instagram') return normalizeInstagramComments(scheduledPostId, platform, raw);
  if (p === 'youtube') return normalizeYouTubeComments(scheduledPostId, platform, raw);
  if (p === 'reddit') return normalizeRedditComments(scheduledPostId, platform, raw);
  return [];
}

// ---- Persist (upsert to avoid duplicates) ----

function toDbRow(row: IngestCommentRow): Record<string, unknown> {
  return {
    scheduled_post_id: row.scheduled_post_id,
    platform_comment_id: row.platform_comment_id,
    platform: row.platform,
    author_name: row.author_name,
    author_username: row.author_username ?? null,
    author_profile_url: row.author_profile_url ?? null,
    author_avatar_url: row.author_avatar_url ?? null,
    content: row.content,
    platform_created_at: row.platform_created_at ?? null,
    like_count: row.like_count ?? 0,
    reply_count: row.reply_count ?? 0,
    updated_at: new Date().toISOString(),
  };
}

async function persistComments(rows: IngestCommentRow[]): Promise<void> {
  if (rows.length === 0) return;
  const dbRows = rows.map(toDbRow);
  const { error } = await ownedDbTable('post_comments')
    .upsert(dbRows, {
      onConflict: 'scheduled_post_id,platform_comment_id',
      ignoreDuplicates: false,
    });
  if (error) {
    throw new Error(`Failed to persist comments: ${error.message}`);
  }

  // ── Strategy Analytics runtime activation (additive + best-effort) ──
  // Mirror each persisted comment as a 'comment' strategy event so the
  // strategy aggregator + leaderboards reflect comment activity. All
  // failures swallowed — the canonical persist above already succeeded
  // and analytics must never block ingestion (PHASE 6).
  try {
    const { recordCommentStrategyEvents } =
      await import('./creator/strategyAnalyticsRuntime');
    // Group comments by scheduled_post_id (rare to have >1 post per
    // batch but handle it correctly).
    const countByPost = new Map<string, number>();
    for (const row of rows) {
      const key = row.scheduled_post_id;
      if (!key) continue;
      countByPost.set(key, (countByPost.get(key) ?? 0) + 1);
    }
    await Promise.all(
      Array.from(countByPost.entries()).map(([scheduledPostId, commentCount]) =>
        recordCommentStrategyEvents({ scheduledPostId, commentCount }),
      ),
    );
  } catch (err: unknown) {
    console.warn(
      '[engagementIngestion] strategy analytics recording failed (non-fatal):',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Sync ingested comments to the unified engagement model (engagement_messages, etc.).
 * Non-blocking: failures are logged but do not affect the main ingestion flow.
 */
async function syncToUnifiedEngagement(
  rows: IngestCommentRow[],
  context: { platform_post_id: string; organization_id: string | null; platform: string; scheduled_post_id: string }
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { syncFromPostComments } = await import('./engagementNormalizationService');
    const syncRows = rows.map((r) => ({
      platform_comment_id: r.platform_comment_id,
      platform: r.platform,
      author_name: r.author_name,
      author_username: r.author_username ?? null,
      author_profile_url: r.author_profile_url ?? null,
      author_avatar_url: r.author_avatar_url ?? null,
      content: r.content,
      platform_created_at: r.platform_created_at ?? null,
      like_count: r.like_count ?? 0,
      reply_count: r.reply_count ?? 0,
    }));
    const result = await syncFromPostComments(syncRows, context);
    if (result.errors > 0) {
      console.warn('[engagementIngestion] unified sync had errors', { synced: result.synced, errors: result.errors });
    }
  } catch (e: any) {
    console.warn('[engagementIngestion] unified sync failed', e?.message);
  }
}

// ---- Public API ----

/**
 * Why an ingest attempt failed, as a value rather than a prose message.
 *
 * `needs_reauth` is the one an operator must act on: the connection has been
 * parked and will stay parked until the user reconnects.
 */
export type IngestFailureKind =
  | 'config'          // no credential on the account at all
  | 'needs_reauth'    // credential proven dead; account parked for reconnection
  | 'refresh_failed'  // refresh failed before the request; nothing was sent
  | 'auth'            // provider rejected the credential
  | 'not_found'       // endpoint/resource absent — no credential will fix this
  | 'provider';       // any other provider or persistence failure

export type IngestCommentsResult = {
  success: boolean;
  ingested: number;
  error?: string;
  failure?: IngestFailureKind;
};

/**
 * Ingest comments for a single scheduled post.
 * Loads post, resolves token (tokenStore / social_accounts), fetches from platform, normalizes, upserts into post_comments.
 */
export async function ingestComments(scheduled_post_id: string): Promise<IngestCommentsResult> {
  const post = await getScheduledPost(scheduled_post_id);
  if (!post) {
    return { success: false, ingested: 0, error: 'Scheduled post not found' };
  }
  const platformPostId = post.platform_post_id;
  if (!platformPostId) {
    return { success: false, ingested: 0, error: 'Post not yet published (no platform_post_id)' };
  }
  let token = await getToken(post.social_account_id);
  if (!token?.access_token) {
    return { success: false, ingested: 0, error: 'No access token for social account', failure: 'config' };
  }
  // Parked for reconnection — the credential is known dead. Re-attempting it
  // every 10 minutes is what produced an unbounded failure loop before.
  if (token.is_active === false) {
    return {
      success: false,
      ingested: 0,
      error: 'Social account requires reconnection',
      failure: 'needs_reauth',
    };
  }
  if (isTokenExpiringSoon(token, 5)) {
    const refreshedToken = await refreshPlatformToken(post.platform, post.social_account_id, token);
    if (refreshedToken?.access_token) {
      token = refreshedToken;
    } else {
      // Previously this fell through and called the provider with the stale
      // token — a guaranteed 401 reported as a fetch failure. Stop here and say
      // what actually happened. Not parked: a refresh can fail transiently.
      console.warn('[engagementIngestion] proactive token refresh failed', {
        scheduled_post_id,
        platform: post.platform,
      });
      return {
        success: false,
        ingested: 0,
        error: 'Token refresh failed before request; not retrying with stale credential',
        failure: 'refresh_failed',
      };
    }
  }
  try {
    let raw: any;
    try {
      raw = await fetchCommentsWithAdapterFallback(post.platform, platformPostId, token.access_token);
    } catch (firstErr: any) {
      if (!isAuthFailure(firstErr)) throw firstErr;
      // The provider rejected the credential. Refresh ONCE and retry ONCE —
      // never a loop, and never a second attempt on the same token.
      const refreshedToken = await refreshPlatformToken(post.platform, post.social_account_id, token);
      if (!refreshedToken?.access_token) {
        await markSocialAccountNeedsReauth(
          post.social_account_id,
          `${post.platform} rejected credential and refresh failed`,
        );
        return {
          success: false,
          ingested: 0,
          error: 'Authentication failed and token refresh failed; reconnection required',
          failure: 'needs_reauth',
        };
      }
      token = refreshedToken;
      try {
        raw = await fetchCommentsWithAdapterFallback(post.platform, platformPostId, token.access_token);
      } catch (retryErr: any) {
        if (isAuthFailure(retryErr)) {
          // Refreshed credential still rejected — this is unrecoverable.
          await markSocialAccountNeedsReauth(
            post.social_account_id,
            `${post.platform} rejected refreshed credential`,
          );
          return {
            success: false,
            ingested: 0,
            error: 'Authentication failed after token refresh; reconnection required',
            failure: 'needs_reauth',
          };
        }
        throw retryErr;
      }
    }
    const rows = normalizeCommentsForPlatform(scheduled_post_id, post.platform, raw);
    await persistComments(rows);
    const ingested = rows.length;
    console.info('[engagementIngestion] ingestComments completed', {
      scheduled_post_id,
      platform: post.platform,
      platform_post_id: platformPostId,
      ingested,
    });
    if (ingested > 0) {
      let organizationId: string | null = null;
      if (post.campaign_id) {
        const version = await getLatestCampaignVersionByCampaignId(post.campaign_id);
        organizationId = version?.company_id ? String(version.company_id) : null;
      }
      if (!organizationId && post.user_id) {
        const { data: role } = await ownedDbTable('user_company_roles')
          .select('company_id')
          .eq('user_id', post.user_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        organizationId = role?.company_id ? String(role.company_id) : null;
      }
      syncToUnifiedEngagement(rows, {
        platform_post_id: platformPostId,
        organization_id: organizationId,
        platform: post.platform,
        scheduled_post_id,
      }).catch(() => {});
      try {
        const { evaluatePostEngagement } = await import('./engagementEvaluationService');
        await evaluatePostEngagement(scheduled_post_id);
      } catch (evalErr: any) {
        console.warn('[engagementIngestion] evaluation trigger failed', evalErr?.message);
      }
    }
    return { success: true, ingested };
  } catch (e: any) {
    // Structured, redacted diagnosis. `statusText` alone made a permanent wrong
    // endpoint ("Not Found") and an expired token ("Unauthorized") look like the
    // same class of problem; the failure kind and provider code separate them.
    const providerDetail = isProviderRequestError(e) ? e.toLogPayload() : {};
    console.warn('[engagementIngestion] ingestComments failed', {
      scheduled_post_id,
      platform: post.platform,
      platform_post_id: platformPostId,
      error: e?.message ?? 'Failed to fetch or persist comments',
      ...providerDetail,
    });
    return {
      success: false,
      ingested: 0,
      error: e?.message ?? 'Failed to fetch or persist comments',
      failure: isProviderRequestError(e)
        ? (e.kind === 'not_found' ? 'not_found' : e.kind === 'auth' ? 'auth' : 'provider')
        : 'provider',
    };
  }
}

/**
 * Find recently published posts (status = 'published', platform_post_id not null)
 * and ingest comments for each. No scheduler wiring — call this from a job or cron.
 */
export async function ingestRecentPublishedPosts(): Promise<{
  processed: number;
  totalIngested: number;
  errors: { scheduled_post_id: string; error: string }[];
}> {
  // The function is named "recent" and documented as "recently published", but
  // had no date filter — so every 10-minute tick reprocessed the entire lifetime
  // population of published posts, and the failure volume grew with post count.
  //
  // 30 days is chosen from the ingestion semantics, not to quieten logs: late
  // engagement on social posts is real and worth collecting for weeks, while X
  // recent search cannot see replies older than 7 days at all, and LinkedIn
  // comment activity on a month-old post is negligible. 30 days comfortably
  // covers both providers' useful range with headroom.
  const windowStart = new Date(Date.now() - INGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: posts, error } = await ownedDbTable('scheduled_posts')
    .select('id')
    .eq('status', 'published')
    .not('platform_post_id', 'is', null)
    .gte('published_at', windowStart);

  if (error) {
    throw new Error(`Failed to query published posts: ${error.message}`);
  }
  const list = posts ?? [];
  let totalIngested = 0;
  const errors: { scheduled_post_id: string; error: string }[] = [];
  // HARDEN-004: per-post ingestion is independent (network-bound platform
  // fetch + idempotent upserts) — bounded concurrency replaces the strictly
  // sequential loop. Results are aggregated in input order, so totals and the
  // errors array are identical to the sequential run.
  const { mapWithConcurrency, getSchedulerConcurrency } = await import('../scheduler/schedulerBatching');
  const results = await mapWithConcurrency(list, getSchedulerConcurrency(), (p) => ingestComments(p.id));
  for (let i = 0; i < results.length; i++) {
    const slot = results[i];
    const result = (slot.ok && slot.value !== undefined)
      ? slot.value
      : { success: false, ingested: 0, error: slot.error?.message ?? 'unknown error' };
    if (result.success) {
      totalIngested += result.ingested;
    } else if (result.error) {
      errors.push({ scheduled_post_id: list[i].id, error: result.error });
    }
  }
  console.info('[engagementIngestion] ingestRecentPublishedPosts completed', {
    processed: list.length,
    total_ingested: totalIngested,
    errors: errors.length,
  });
  return {
    processed: list.length,
    totalIngested,
    errors,
  };
}

export type IngestCommunityResult = {
  success: boolean;
  ingested: number;
  error?: string;
};

/**
 * Ingest messages from a community platform channel.
 * When platform_category = community: uses adapter.fetchComments() and syncs to engagement_messages.
 */
export async function ingestCommunityChannel(
  platformKey: string,
  channelId: string,
  accessToken: string,
  organizationId: string | null
): Promise<IngestCommunityResult> {
  const category = await getPlatformCategory(platformKey);
  if (category !== 'community') {
    return { success: false, ingested: 0, error: `Platform ${platformKey} is not a community platform` };
  }
  const adapter = getPlatformAdapter(platformKey);
  if (!adapter) {
    return { success: false, ingested: 0, error: `No adapter for platform ${platformKey}` };
  }
  try {
    const raw = await adapter.fetchComments({ platformPostId: channelId, accessToken });
    const rows = Array.isArray(raw) ? raw : [];
    const communityRows = rows.filter(
      (r: any) => r?.thread_id != null && r?.message_id != null && r?.platform != null
    );
    if (communityRows.length === 0) {
      return { success: true, ingested: 0 };
    }
    const { syncFromCommunityMessages } = await import('./engagementNormalizationService');
    const result = await syncFromCommunityMessages(communityRows, {
      platform: platformKey,
      organization_id: organizationId,
      channel_id: channelId,
    });
    return { success: true, ingested: result.synced };
  } catch (e: any) {
    return {
      success: false,
      ingested: 0,
      error: e?.message ?? 'Failed to ingest community channel',
    };
  }
}

/**
 * Return comments from DB for a scheduled post (after ingestion).
 */
export async function getCommentsForScheduledPost(scheduled_post_id: string): Promise<any[]> {
  const { data, error } = await ownedDbTable('post_comments')
    .select('*')
    .eq('scheduled_post_id', scheduled_post_id)
    .order('platform_created_at', { ascending: true });
  if (error) return [];
  return data ?? [];
}
