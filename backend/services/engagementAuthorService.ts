/**
 * Engagement Author Service
 *
 * Provides author profile and engagement stats for the Unified Engagement Inbox.
 */

import { supabase } from '../db/supabaseClient';

export type AuthorProfile = {
  id: string;
  platform: string;
  platform_user_id: string;
  username: string | null;
  display_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  created_at: string | null;
};

export type AuthorRecentMessage = {
  message_id: string;
  thread_id: string;
  content: string | null;
  platform: string;
  platform_created_at: string | null;
};

export type AuthorEngagementStats = {
  total_messages: number;
  total_threads: number;
  last_interaction: string | null;
};

export type AuthorWithStats = {
  profile: AuthorProfile;
  recent_messages: AuthorRecentMessage[];
  engagement_stats: AuthorEngagementStats;
};

export async function getAuthor(author_id: string): Promise<AuthorWithStats | null> {
  const { data: author, error: authorError } = await supabase
    .from('engagement_authors')
    .select('id, platform, platform_user_id, username, display_name, profile_url, avatar_url, created_at')
    .eq('id', author_id)
    .maybeSingle();

  if (authorError || !author) {
    return null;
  }

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform, platform_created_at')
    .eq('author_id', author_id)
    .order('platform_created_at', { ascending: false })
    .limit(10);

  const threadIds = [...new Set((messages ?? []).map((m: any) => m.thread_id))];

  const profile: AuthorProfile = {
    id: author.id,
    platform: author.platform ?? '',
    platform_user_id: author.platform_user_id ?? '',
    username: author.username ?? null,
    display_name: author.display_name ?? null,
    profile_url: author.profile_url ?? null,
    avatar_url: author.avatar_url ?? null,
    created_at: author.created_at ?? null,
  };

  const recent_messages: AuthorRecentMessage[] = (messages ?? []).map((m: any) => ({
    message_id: m.id,
    thread_id: m.thread_id,
    content: m.content ?? null,
    platform: m.platform ?? '',
    platform_created_at: m.platform_created_at ?? null,
  }));

  const { count: totalMessages } = await supabase
    .from('engagement_messages')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', author_id);

  const { data: threadRows } = await supabase
    .from('engagement_messages')
    .select('thread_id')
    .eq('author_id', author_id);

  const totalThreads = new Set((threadRows ?? []).map((r: { thread_id: string }) => r.thread_id)).size;
  const lastInteraction = messages?.[0]?.platform_created_at ?? null;

  const engagement_stats: AuthorEngagementStats = {
    total_messages: totalMessages ?? 0,
    total_threads: totalThreads,
    last_interaction: lastInteraction,
  };

  return {
    profile,
    recent_messages,
    engagement_stats,
  };
}
