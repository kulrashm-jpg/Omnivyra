/**
 * AI Activity Queue Service
 *
 * Centralized read-only queue of pending community_ai_actions with runtime priority.
 * No new tables; loads from community_ai_actions, decorates with priority and related data.
 */

import { supabase } from '../db/supabaseClient';
import { decorateActionsWithPriority } from './engagementPriorityService';

export type GetAiActivityQueueOptions = {
  tenant_id: string;
  organization_id: string;
  status?: string;
};

/**
 * Load pending actions for tenant/org, attach related scheduled_post and comment where possible,
 * decorate with priority (runtime), sort by priority_score DESC, created_at DESC.
 */
export async function getAiActivityQueue(
  options: GetAiActivityQueueOptions
): Promise<{ queue: any[] }> {
  const status = options.status ?? 'pending';

  const { data: actions, error } = await supabase
    .from('community_ai_actions')
    .select('*')
    .eq('tenant_id', options.tenant_id)
    .eq('organization_id', options.organization_id)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load activity queue: ${error.message}`);
  }

  const list = actions ?? [];
  if (list.length === 0) {
    return { queue: [] };
  }

  const targetIds = [...new Set(list.map((a) => a.target_id).filter(Boolean))];
  const platforms = [...new Set(list.map((a) => a.platform).filter(Boolean))];

  let scheduledPostsByTarget: Record<string, any> = {};
  let commentsByTarget: Record<string, any> = {};
  const actionIdToTargetId: Record<string, string> = {};
  list.forEach((a) => {
    actionIdToTargetId[a.id] = a.target_id;
  });

  if (targetIds.length > 0 && platforms.length > 0) {
    const { data: posts } = await supabase
      .from('scheduled_posts')
      .select('*')
      .in('platform_post_id', targetIds)
      .in('platform', platforms);
    (posts ?? []).forEach((p: any) => {
      const key = `${p.platform}:${p.platform_post_id}`;
      scheduledPostsByTarget[key] = p;
    });

    const { data: comments } = await supabase
      .from('post_comments')
      .select('*')
      .in('platform_comment_id', targetIds)
      .in('platform', platforms);
    (comments ?? []).forEach((c: any) => {
      const key = `${c.platform}:${c.platform_comment_id}`;
      commentsByTarget[key] = c;
    });
  }

  const commentTextByActionId: Record<string, string | null> = {};
  const withRelated = list.map((action) => {
    const targetId = action.target_id;
    const platform = (action.platform ?? '').toString().trim();
    const key = `${platform}:${targetId}`;
    const related_scheduled_post = scheduledPostsByTarget[key] ?? null;
    const related_comment = commentsByTarget[key] ?? null;
    if (related_comment?.content) {
      commentTextByActionId[action.id] = related_comment.content;
    }
    return {
      ...action,
      related_scheduled_post: related_scheduled_post ? sanitizePost(related_scheduled_post) : null,
      related_comment: related_comment ? sanitizeComment(related_comment) : null,
    };
  });

  const decorated = decorateActionsWithPriority(withRelated, { commentTextByActionId });
  decorated.sort((a, b) => {
    const scoreA = a.priority_score ?? 0;
    const scoreB = b.priority_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const atA = a.created_at ?? '';
    const atB = b.created_at ?? '';
    return atB.localeCompare(atA);
  });

  return { queue: decorated };
}

function sanitizePost(p: any): any {
  return {
    id: p.id,
    platform: p.platform,
    platform_post_id: p.platform_post_id,
    content: p.content?.slice(0, 300),
    campaign_id: p.campaign_id,
    scheduled_for: p.scheduled_for,
    status: p.status,
  };
}

function sanitizeComment(c: any): any {
  return {
    id: c.id,
    platform_comment_id: c.platform_comment_id,
    platform: c.platform,
    content: c.content?.slice(0, 500),
    author_name: c.author_name,
    platform_created_at: c.platform_created_at,
  };
}
