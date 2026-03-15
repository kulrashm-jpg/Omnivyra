/**
 * Engagement Message Service
 *
 * Provides message listing for conversation threads in the Unified Engagement Inbox.
 */

import { supabase } from '../db/supabaseClient';

export type ThreadMessage = {
  message_id: string;
  author: {
    id: string;
    username: string | null;
    display_name: string | null;
    profile_url: string | null;
    avatar_url: string | null;
  } | null;
  content: string | null;
  platform: string;
  message_type: string;
  like_count: number;
  reply_count: number;
  created_at: string | null;
  platform_created_at: string | null;
  parent_message_id: string | null;
};

export async function getThreadMessages(thread_id: string): Promise<ThreadMessage[]> {
  const { data: messages, error } = await supabase
    .from('engagement_messages')
    .select(`
      id,
      content,
      platform,
      message_type,
      like_count,
      reply_count,
      created_at,
      platform_created_at,
      parent_message_id,
      author_id,
      engagement_authors (
        id,
        username,
        display_name,
        profile_url,
        avatar_url
      )
    `)
    .eq('thread_id', thread_id)
    .order('platform_created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch thread messages: ${error.message}`);
  }

  return (messages ?? []).map((m: any) => {
    const author = m.engagement_authors;
    return {
      message_id: m.id,
      author: author
        ? {
            id: author.id,
            username: author.username ?? null,
            display_name: author.display_name ?? null,
            profile_url: author.profile_url ?? null,
            avatar_url: author.avatar_url ?? null,
          }
        : null,
      content: m.content ?? null,
      platform: m.platform ?? '',
      message_type: m.message_type ?? 'comment',
      like_count: m.like_count ?? 0,
      reply_count: m.reply_count ?? 0,
      created_at: m.created_at ?? null,
      platform_created_at: m.platform_created_at ?? null,
      parent_message_id: m.parent_message_id ?? null,
    };
  });
}
