/**
 * OmniVyra Engagement Input Adapter
 *
 * Builds OmniVyra evaluation input from engagement_messages (unified model).
 * OmniVyra continues to read post_comments by default; this adapter allows
 * optional use of engagement_messages for evaluation.
 *
 * DO NOT change engagementEvaluationService behavior — it still uses post_comments.
 */

import { supabase } from '../db/supabaseClient';

export type BuildOmnivyraEngagementInputOptions = {
  tenant_id: string;
  organization_id: string;
  platform: string;
  thread_id: string;
  post_data?: {
    scheduled_post_id?: string;
    platform_post_id?: string;
    content?: string;
    platform?: string;
  };
  brand_voice?: string;
};

export type OmnivyraEngagementInput = {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  post_data?: any;
  engagement_activity: any[];
  engagement_metrics: { total_comments: number; recent_comments: number };
  brand_voice: string;
  context?: any;
};

/**
 * Build OmniVyra engagement evaluation input from engagement_messages.
 * Fetches messages for the thread, joins authors, normalizes to post_comments-like shape.
 */
export async function buildOmnivyraEngagementInput(
  options: BuildOmnivyraEngagementInputOptions
): Promise<OmnivyraEngagementInput | null> {
  const { data: messages, error: msgError } = await supabase
    .from('engagement_messages')
    .select(`
      id,
      content,
      platform,
      platform_message_id,
      platform_created_at,
      like_count,
      reply_count,
      sentiment_score,
      engagement_authors (
        id,
        username,
        display_name,
        profile_url
      )
    `)
    .eq('thread_id', options.thread_id)
    .order('platform_created_at', { ascending: true });

  if (msgError || !messages || messages.length === 0) {
    return null;
  }

  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const engagement_activity = messages.map((m: any) => {
    const author = m.engagement_authors;
    return {
      id: m.id,
      platform_comment_id: m.platform_message_id,
      platform: m.platform,
      author_name: author?.display_name ?? author?.username ?? 'Unknown',
      author_username: author?.username ?? null,
      author_profile_url: author?.profile_url ?? null,
      content: m.content ?? '',
      platform_created_at: m.platform_created_at ?? null,
      like_count: m.like_count ?? 0,
      reply_count: m.reply_count ?? 0,
      sentiment_score: m.sentiment_score ?? null,
    };
  });

  const recentComments = engagement_activity.filter(
    (c: any) => c.platform_created_at && c.platform_created_at >= recentCutoff
  );

  return {
    tenant_id: options.tenant_id,
    organization_id: options.organization_id,
    platform: options.platform,
    post_data: options.post_data ?? {},
    engagement_activity,
    engagement_metrics: {
      total_comments: engagement_activity.length,
      recent_comments: recentComments.length,
    },
    brand_voice: options.brand_voice ?? 'professional',
    context: { source: 'engagement_messages', thread_id: options.thread_id },
  };
}
