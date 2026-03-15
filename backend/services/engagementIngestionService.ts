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
import { getToken } from '../auth/tokenStore';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { syncFromPostComments } from './engagementNormalizationService';
import { getPlatformAdapter } from './platformAdapters';
import { getPlatformCategory } from './platformRegistryService';

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
      },
    }
  );
  if (!response.ok) {
    throw new Error(`LinkedIn comments fetch failed: ${response.statusText}`);
  }
  return response.json();
}

async function fetchTwitterComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(`https://api.twitter.com/2/tweets/${platformPostId}/replies`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Twitter replies fetch failed: ${response.statusText}`);
  }
  return response.json();
}

async function fetchFacebookComments(accessToken: string, platformPostId: string): Promise<any> {
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${platformPostId}/comments`,
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
    `https://graph.facebook.com/v18.0/${platformPostId}/comments`,
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
 * Fetch comments via platform adapter when available; fallback to legacy direct fetchers.
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
      console.warn('[engagementIngestion] Adapter fetch failed, falling back to legacy:', e?.message);
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
  if (p === 'facebook' || p === 'instagram') {
    return normalizeFacebookComments(scheduledPostId, platform, raw);
  }
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
  const { error } = await supabase
    .from('post_comments')
    .upsert(dbRows, {
      onConflict: 'scheduled_post_id,platform_comment_id',
      ignoreDuplicates: false,
    });
  if (error) {
    throw new Error(`Failed to persist comments: ${error.message}`);
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

export type IngestCommentsResult = {
  success: boolean;
  ingested: number;
  error?: string;
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
  const token = await getToken(post.social_account_id);
  if (!token?.access_token) {
    return { success: false, ingested: 0, error: 'No access token for social account' };
  }
  try {
    const raw = await fetchCommentsWithAdapterFallback(
      post.platform,
      platformPostId,
      token.access_token
    );
    const rows = normalizeCommentsForPlatform(scheduled_post_id, post.platform, raw);
    await persistComments(rows);
    const ingested = rows.length;
    if (ingested > 0) {
      let organizationId: string | null = null;
      if (post.campaign_id) {
        const version = await getLatestCampaignVersionByCampaignId(post.campaign_id);
        organizationId = version?.company_id ? String(version.company_id) : null;
      }
      if (!organizationId && post.user_id) {
        const { data: role } = await supabase
          .from('user_company_roles')
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
    return {
      success: false,
      ingested: 0,
      error: e?.message ?? 'Failed to fetch or persist comments',
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
  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('status', 'published')
    .not('platform_post_id', 'is', null);

  if (error) {
    throw new Error(`Failed to query published posts: ${error.message}`);
  }
  const list = posts ?? [];
  let totalIngested = 0;
  const errors: { scheduled_post_id: string; error: string }[] = [];
  for (const p of list) {
    const result = await ingestComments(p.id);
    if (result.success) {
      totalIngested += result.ingested;
    } else if (result.error) {
      errors.push({ scheduled_post_id: p.id, error: result.error });
    }
  }
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
  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('scheduled_post_id', scheduled_post_id)
    .order('platform_created_at', { ascending: true });
  if (error) return [];
  return data ?? [];
}
