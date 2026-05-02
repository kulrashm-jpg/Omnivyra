import { supabase } from '../db/supabaseClient';
import { ingestComments } from './engagementIngestionService';
import { getPlatformsWithTokensForOrg } from './platformTokenService';

const LINKEDIN_PLATFORM = 'linkedin';
const SYNC_LOOKBACK_DAYS = 30;
const MAX_SYNC_POSTS = 20;

async function getLinkedInThreadCounts(organizationId: string) {
  const { data: threads, error: threadListError, count: threadCount } = await supabase
    .from('engagement_threads')
    .select('id', { count: 'exact' })
    .eq('organization_id', organizationId)
    .eq('platform', LINKEDIN_PLATFORM);

  if (threadListError) {
    throw new Error(`Failed to load LinkedIn threads: ${threadListError.message}`);
  }

  const threadIds = (threads ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  if (threadIds.length === 0) {
    return {
      threadCount: threadCount ?? 0,
      messageCount: 0,
    };
  }

  const { count: messageCount, error: messageCountError } = await supabase
    .from('engagement_messages')
    .select('id', { count: 'exact', head: true })
    .in('thread_id', threadIds);

  if (messageCountError) {
    throw new Error(`Failed to load LinkedIn messages: ${messageCountError.message}`);
  }

  const { data: dmMessages, error: dmMessageError } = await supabase
    .from('engagement_messages')
    .select('thread_id')
    .in('thread_id', threadIds)
    .in('message_type', ['dm', 'direct_message']);

  if (dmMessageError) {
    throw new Error(`Failed to load LinkedIn DM messages: ${dmMessageError.message}`);
  }

  const { data: dmFallbackMessages, error: dmFallbackError } = await supabase
    .from('engagement_messages')
    .select('thread_id')
    .in('thread_id', threadIds)
    .contains('raw_payload', { original_message_type: 'dm' });

  if (dmFallbackError) {
    throw new Error(`Failed to load LinkedIn fallback DM messages: ${dmFallbackError.message}`);
  }

  const dmThreadIds = new Set(
    [...(dmMessages ?? []), ...(dmFallbackMessages ?? [])]
      .map((row: { thread_id: string }) => row.thread_id)
      .filter(Boolean)
  );

  return {
    threadCount: threadCount ?? threadIds.length,
    messageCount: messageCount ?? 0,
    dmThreadCount: dmThreadIds.size,
    dmMessageCount: (dmMessages?.length ?? 0) + (dmFallbackMessages?.length ?? 0),
  };
}

export type LinkedInEngagementOverview = {
  platform: 'linkedin';
  connected: boolean;
  activeAccountCount: number;
  publishedPosts: number;
  syncCandidates: number;
  rawComments: number;
  inboxThreads: number;
  inboxMessages: number;
  dmThreads: number;
  dmMessages: number;
  latestPublishedAt: string | null;
  latestInboxActivityAt: string | null;
  blockers: string[];
  coverage: {
    inboxScope: 'published-post-comments';
    backendReplyMode: 'partial';
    browserFallbackSupported: true;
  };
};

export type LinkedInEngagementSyncResult = {
  platform: 'linkedin';
  success: boolean;
  processedPosts: number;
  ingestedComments: number;
  failedPosts: number;
  latestPublishedAt: string | null;
  threadsAfterSync: number;
  messagesAfterSync: number;
  syncedAt: string;
};

async function getActiveCompanyUserIds(organizationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', organizationId)
    .eq('status', 'active');

  if (error) {
    throw new Error(`Failed to load company users: ${error.message}`);
  }

  return (data ?? []).map((row: { user_id: string }) => row.user_id).filter(Boolean);
}

async function getPublishedLinkedInPosts(organizationId: string, limit = MAX_SYNC_POSTS) {
  const userIds = await getActiveCompanyUserIds(organizationId);
  if (userIds.length === 0) return [];

  const cutoffIso = new Date(Date.now() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, published_at, platform_post_id, social_account_id')
    .in('user_id', userIds)
    .eq('platform', LINKEDIN_PLATFORM)
    .eq('status', 'published')
    .gte('published_at', cutoffIso)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load LinkedIn posts: ${error.message}`);
  }

  return data ?? [];
}

async function getLinkedInSocialAccountCount(organizationId: string): Promise<number> {
  const userIds = await getActiveCompanyUserIds(organizationId);
  if (userIds.length === 0) return 0;

  const { count, error } = await supabase
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .in('user_id', userIds)
    .eq('platform', LINKEDIN_PLATFORM)
    .eq('is_active', true)
    .or(`company_id.eq.${organizationId},company_id.is.null`);

  if (error) {
    throw new Error(`Failed to load LinkedIn accounts: ${error.message}`);
  }

  return count ?? 0;
}

export async function getLinkedInEngagementOverview(
  organizationId: string
): Promise<LinkedInEngagementOverview> {
  const [connectedPlatforms, activeAccountCount, publishedPosts, threadCounts, latestThreadResult] =
    await Promise.all([
      getPlatformsWithTokensForOrg(organizationId),
      getLinkedInSocialAccountCount(organizationId),
      getPublishedLinkedInPosts(organizationId, 100),
      getLinkedInThreadCounts(organizationId),
      supabase
        .from('engagement_threads')
        .select('updated_at')
        .eq('organization_id', organizationId)
        .eq('platform', LINKEDIN_PLATFORM)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (latestThreadResult.error) {
    throw new Error(`Failed to load LinkedIn activity: ${latestThreadResult.error.message}`);
  }

  const connected = connectedPlatforms.includes(LINKEDIN_PLATFORM);
  const latestPublishedAt = publishedPosts[0]?.published_at ?? null;
  const syncCandidates = publishedPosts.filter(
    (row: { platform_post_id?: string | null; social_account_id?: string | null }) =>
      Boolean(row.platform_post_id) && Boolean(row.social_account_id)
  ).length;

  let rawComments = 0;
  const publishedPostIds = publishedPosts.map((row: { id: string }) => row.id).filter(Boolean);
  if (publishedPostIds.length > 0) {
    const { count, error } = await supabase
      .from('post_comments')
      .select('id', { count: 'exact', head: true })
      .in('scheduled_post_id', publishedPostIds);

    if (error) {
      throw new Error(`Failed to load LinkedIn raw comments: ${error.message}`);
    }

    rawComments = count ?? 0;
  }

  const blockers: string[] = [];
  if (!connected) blockers.push('LinkedIn is not connected for this company yet.');
  if (publishedPosts.length === 0) blockers.push('No LinkedIn post has been published from this workspace in the last 30 days.');
  if (publishedPosts.length > 0 && syncCandidates === 0) blockers.push('Published LinkedIn posts are missing platform post IDs or linked social accounts.');
  if (syncCandidates > 0 && rawComments === 0) blockers.push('No LinkedIn comments have been pulled into Omnivyra yet.');
  if (rawComments > 0 && threadCounts.threadCount === 0) blockers.push('LinkedIn comments exist, but the unified inbox threads have not been built yet.');

  return {
    platform: 'linkedin',
    connected,
    activeAccountCount,
    publishedPosts: publishedPosts.length,
    syncCandidates,
    rawComments,
    inboxThreads: threadCounts.threadCount,
    inboxMessages: threadCounts.messageCount,
    dmThreads: threadCounts.dmThreadCount,
    dmMessages: threadCounts.dmMessageCount,
    latestPublishedAt,
    latestInboxActivityAt: latestThreadResult.data?.updated_at ?? null,
    blockers,
    coverage: {
      inboxScope: 'published-post-comments',
      backendReplyMode: 'partial',
      browserFallbackSupported: true,
    },
  };
}

export async function syncLinkedInEngagement(
  organizationId: string
): Promise<LinkedInEngagementSyncResult> {
  const posts = await getPublishedLinkedInPosts(organizationId);
  const candidates = posts.filter(
    (row: { platform_post_id?: string | null; social_account_id?: string | null }) =>
      Boolean(row.platform_post_id) && Boolean(row.social_account_id)
  );

  let processedPosts = 0;
  let ingestedComments = 0;
  let failedPosts = 0;

  for (const post of candidates) {
    processedPosts += 1;
    try {
      const result = await ingestComments(post.id);
      if (result.success) {
        ingestedComments += result.ingested;
      } else {
        failedPosts += 1;
      }
    } catch (error) {
      console.warn('[linkedinEngagementWorkspace] sync failed for post', post.id, error);
      failedPosts += 1;
    }
  }

  const threadCounts = await getLinkedInThreadCounts(organizationId);

  return {
    platform: 'linkedin',
    success: true,
    processedPosts,
    ingestedComments,
    failedPosts,
    latestPublishedAt: posts[0]?.published_at ?? null,
    threadsAfterSync: threadCounts.threadCount,
    messagesAfterSync: threadCounts.messageCount,
    syncedAt: new Date().toISOString(),
  };
}
