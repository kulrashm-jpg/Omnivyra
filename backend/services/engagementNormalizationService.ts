/**
 * Engagement Normalization Service
 *
 * Synchronization layer for the Unified Engagement Data Model.
 * Resolves engagement_sources, engagement_authors, engagement_threads,
 * and inserts into engagement_messages.
 *
 * Used by engagementIngestionService when comments are persisted to post_comments.
 * Does not modify post_comments or break existing pipelines.
 */

import { supabase } from '../db/supabaseClient';
import { recordMetric } from './systemHealthMetricsService';

export type NormalizedAuthorInput = {
  platform: string;
  platform_user_id: string;
  username?: string | null;
  display_name?: string | null;
  profile_url?: string | null;
  avatar_url?: string | null;
};

export type NormalizedMessageInput = {
  thread_id: string;
  source_id: string | null;
  author_id: string | null;
  platform: string;
  platform_message_id: string;
  message_type: 'comment' | 'reply' | 'mention' | 'dm';
  parent_message_id?: string | null;
  content: string;
  raw_payload?: Record<string, unknown> | null;
  like_count?: number;
  reply_count?: number;
  sentiment_score?: number | null;
  platform_created_at?: string | null;
  post_comment_id?: string | null;
};

const normalizePlatform = (p: string) => (p || '').toString().trim().toLowerCase();

/**
 * Resolve or create engagement_source by platform.
 */
export async function resolveSource(
  platform: string,
  sourceType: 'api' | 'rpa' = 'api'
): Promise<string | null> {
  const p = normalizePlatform(platform);
  if (!p) return null;

  const { data: existing, error: fetchError } = await supabase
    .from('engagement_sources')
    .select('id')
    .eq('platform', p)
    .maybeSingle();

  if (fetchError) {
    console.warn('[engagementNormalization] resolveSource fetch error', fetchError.message);
    return null;
  }
  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('engagement_sources')
    .insert({ platform: p, source_type: sourceType })
    .select('id')
    .single();

  if (insertError) {
    console.warn('[engagementNormalization] resolveSource insert error', insertError.message);
    return null;
  }
  return inserted?.id ?? null;
}

/**
 * Resolve or create engagement_author.
 * platform_user_id is required; use username or profile_url as fallback when platform does not provide ID.
 */
export async function resolveAuthor(input: NormalizedAuthorInput): Promise<string | null> {
  const platform = normalizePlatform(input.platform);
  const platformUserId = (input.platform_user_id || '').toString().trim();
  if (!platform || !platformUserId) return null;

  const { data: existing, error: fetchError } = await supabase
    .from('engagement_authors')
    .select('id')
    .eq('platform', platform)
    .eq('platform_user_id', platformUserId)
    .maybeSingle();

  if (fetchError) {
    console.warn('[engagementNormalization] resolveAuthor fetch error', fetchError.message);
    return null;
  }
  if (existing?.id) return existing.id;

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('engagement_authors')
    .insert({
      platform,
      platform_user_id: platformUserId,
      username: input.username ?? null,
      display_name: input.display_name ?? null,
      profile_url: input.profile_url ?? null,
      avatar_url: input.avatar_url ?? null,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (insertError) {
    console.warn('[engagementNormalization] resolveAuthor insert error', insertError.message);
    return null;
  }
  return inserted?.id ?? null;
}

export type ResolveThreadInput = {
  platform: string;
  platform_thread_id: string;
  source_id: string | null;
  organization_id: string | null;
  root_message_id?: string | null;
};

/**
 * Resolve or create engagement_thread.
 * platform_thread_id = platform_post_id (conversation under a post).
 */
export async function resolveThread(input: ResolveThreadInput): Promise<string | null> {
  const platform = normalizePlatform(input.platform);
  const platformThreadId = (input.platform_thread_id || '').toString().trim();
  if (!platform || !platformThreadId) return null;

  const orgId = input.organization_id?.trim() || null;

  let query = supabase
    .from('engagement_threads')
    .select('id')
    .eq('platform', platform)
    .eq('platform_thread_id', platformThreadId);

  if (orgId) {
    query = query.eq('organization_id', orgId);
  } else {
    query = query.is('organization_id', null);
  }

  const { data: existing, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    console.warn('[engagementNormalization] resolveThread fetch error', fetchError.message);
    return null;
  }
  if (existing?.id) return existing.id;

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('engagement_threads')
    .insert({
      platform,
      platform_thread_id: platformThreadId,
      source_id: input.source_id ?? null,
      organization_id: orgId,
      root_message_id: input.root_message_id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (insertError) {
    console.warn('[engagementNormalization] resolveThread insert error', insertError.message);
    return null;
  }
  return inserted?.id ?? null;
}

export type SyncFromPostCommentsInput = {
  platform_post_id: string;
  organization_id: string | null;
  platform: string;
  scheduled_post_id: string;
};

export type PostCommentRowForSync = {
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

/**
 * Sync a batch of post_comments into the unified engagement model.
 * Call after persistComments. Resolves source, authors, thread; inserts messages.
 */
export async function syncFromPostComments(
  rows: PostCommentRowForSync[],
  context: SyncFromPostCommentsInput
): Promise<{ synced: number; errors: number }> {
  if (rows.length === 0) return { synced: 0, errors: 0 };

  const sourceId = await resolveSource(context.platform, 'api');
  const threadId = await resolveThread({
    platform: context.platform,
    platform_thread_id: context.platform_post_id,
    source_id: sourceId,
    organization_id: context.organization_id,
  });
  if (!threadId) {
    console.warn('[engagementNormalization] syncFromPostComments: could not resolve thread');
    return { synced: 0, errors: rows.length };
  }

  const { data: postComments } = await supabase
    .from('post_comments')
    .select('id, platform_comment_id')
    .eq('scheduled_post_id', context.scheduled_post_id)
    .in('platform_comment_id', rows.map((r) => r.platform_comment_id));
  const commentIdByPlatformId = new Map<string, string>();
  (postComments ?? []).forEach((r: { id: string; platform_comment_id: string }) => {
    commentIdByPlatformId.set(r.platform_comment_id, r.id);
  });

  const sorted = [...rows].sort((a, b) => {
    const atA = a.platform_created_at ?? '';
    const atB = b.platform_created_at ?? '';
    return atA.localeCompare(atB);
  });

  let synced = 0;
  let errors = 0;
  for (const row of sorted) {
    const platformUserId =
      (row.author_username || row.author_profile_url || row.author_name || '').toString().trim() ||
      `anon_${row.platform_comment_id}`;
    const authorId = await resolveAuthor({
      platform: row.platform,
      platform_user_id: platformUserId,
      username: row.author_username ?? null,
      display_name: row.author_name ?? null,
      profile_url: row.author_profile_url ?? null,
      avatar_url: row.author_avatar_url ?? null,
    });
    const msgId = await insertMessage({
      thread_id: threadId,
      source_id: sourceId,
      author_id: authorId,
      platform: row.platform,
      platform_message_id: row.platform_comment_id,
      message_type: 'comment',
      parent_message_id: null,
      content: row.content,
      like_count: row.like_count ?? 0,
      reply_count: row.reply_count ?? 0,
      platform_created_at: row.platform_created_at ?? null,
      post_comment_id: commentIdByPlatformId.get(row.platform_comment_id) ?? null,
    });
    if (msgId) {
      synced++;
      void import('./engagementConversationIntelligenceService')
        .then(({ analyzeMessage }) => analyzeMessage(msgId))
        .catch((err) => console.warn('[engagementNormalization] analyzeMessage async error', err?.message));

      if (context.organization_id) {
        void import('./leadDetectionService')
          .then(({ processMessageForLeads }) =>
            processMessageForLeads({
              organization_id: context.organization_id,
              message_id: msgId,
              thread_id: threadId,
              author_id: authorId ?? null,
              content: row.content ?? '',
              intent: null,
              sentiment: null,
              thread_context: null,
            })
          )
          .catch((err) => console.warn('[engagementNormalization] processMessageForLeads async error', err?.message));
      }
    } else errors++;
  }

  if (synced > 0) {
    void recordMetric('engagement_ingestion', 'messages_ingested', synced, 'count').catch(() => {});
    void recordMetric('engagement_ingestion', 'threads_updated', 1, 'count').catch(() => {});
  }

  return { synced, errors };
}

export type CommunityMessageInput = {
  thread_id: string;
  message_id: string;
  author: string;
  text: string;
  created_at: string;
  platform: string;
};

/**
 * Sync community platform messages into engagement_messages.
 * Used when platform_category = community; adapter returns normalized CommunityMessage[].
 */
export async function syncFromCommunityMessages(
  rows: CommunityMessageInput[],
  context: { platform: string; organization_id: string | null; channel_id: string }
): Promise<{ synced: number; errors: number }> {
  if (rows.length === 0) return { synced: 0, errors: 0 };

  const sourceId = await resolveSource(context.platform, 'api');
  const threadId = await resolveThread({
    platform: context.platform,
    platform_thread_id: context.channel_id,
    source_id: sourceId,
    organization_id: context.organization_id,
  });
  if (!threadId) {
    console.warn('[engagementNormalization] syncFromCommunityMessages: could not resolve thread');
    return { synced: 0, errors: rows.length };
  }

  const sorted = [...rows].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  let synced = 0;
  let errors = 0;
  for (const row of sorted) {
    const platformUserId = (row.author || '').toString().trim() || `anon_${row.message_id}`;
    const authorId = await resolveAuthor({
      platform: row.platform,
      platform_user_id: platformUserId,
      username: row.author ?? null,
      display_name: row.author ?? null,
      profile_url: null,
      avatar_url: null,
    });
    const msgId = await insertMessage({
      thread_id: threadId,
      source_id: sourceId,
      author_id: authorId,
      platform: row.platform,
      platform_message_id: row.message_id,
      message_type: 'comment',
      parent_message_id: null,
      content: row.text ?? '',
      like_count: 0,
      reply_count: 0,
      platform_created_at: row.created_at ?? null,
      post_comment_id: null,
    });
    if (msgId) {
      synced++;
      if (context.organization_id) {
        void import('./communitySignalService')
          .then(({ analyzeAndStoreSignals }) =>
            analyzeAndStoreSignals({
              organization_id: context.organization_id,
              platform: context.platform,
              message_id: msgId,
              thread_id: threadId,
              author_id: authorId ?? null,
              content: row.text ?? '',
            })
          )
          .catch((err) => console.warn('[engagementNormalization] analyzeAndStoreSignals', (err as Error)?.message));
        void import('./leadDetectionService')
          .then(({ processMessageForLeads }) =>
            processMessageForLeads({
              organization_id: context.organization_id,
              message_id: msgId,
              thread_id: threadId,
              author_id: authorId ?? null,
              content: row.text ?? '',
              intent: null,
              sentiment: null,
              thread_context: null,
            })
          )
          .catch((err) => console.warn('[engagementNormalization] processMessageForLeads', (err as Error)?.message));
      }
    } else {
      errors++;
    }
  }
  if (synced > 0) {
    void recordMetric('engagement_ingestion', 'messages_ingested', synced, 'count').catch(() => {});
  }
  return { synced, errors };
}

/**
 * Insert engagement_message (upsert by thread_id + platform_message_id to avoid duplicates).
 */
export async function insertMessage(input: NormalizedMessageInput): Promise<string | null> {
  const { thread_id, platform_message_id, platform, content, message_type } = input;
  if (!thread_id || !platform_message_id || !platform) return null;

  const row = {
    thread_id,
    source_id: input.source_id ?? null,
    author_id: input.author_id ?? null,
    platform: normalizePlatform(platform),
    platform_message_id,
    message_type: message_type || 'comment',
    parent_message_id: input.parent_message_id ?? null,
    content: content ?? '',
    raw_payload: input.raw_payload ?? null,
    like_count: input.like_count ?? 0,
    reply_count: input.reply_count ?? 0,
    sentiment_score: input.sentiment_score ?? null,
    platform_created_at: input.platform_created_at ?? null,
    post_comment_id: input.post_comment_id ?? null,
  };

  const { data: inserted, error } = await supabase
    .from('engagement_messages')
    .upsert(row, {
      onConflict: 'thread_id,platform_message_id',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[engagementNormalization] insertMessage error', error.message);
    return null;
  }

  const messageId = inserted?.id ?? null;
  const platformCreatedAt = input.platform_created_at ?? new Date().toISOString();
  void (async () => {
    try {
      const { data: thread } = await supabase
        .from('engagement_threads')
        .select('organization_id')
        .eq('id', thread_id)
        .maybeSingle();
      await supabase
        .from('conversation_memory_rebuild_queue')
        .upsert(
          {
            thread_id,
            organization_id: thread?.organization_id ?? null,
            latest_message_id: messageId,
            scheduled_at: new Date().toISOString(),
          },
          { onConflict: 'thread_id', ignoreDuplicates: false }
        );
      const { incrementReplyFollowup } = await import('./responsePerformanceService');
      await incrementReplyFollowup(thread_id, platformCreatedAt);
    } catch (err) {
      console.warn('[engagementNormalization] enqueue conversation memory rebuild error', (err as Error)?.message);
    }
  })();

  return inserted?.id ?? null;
}

