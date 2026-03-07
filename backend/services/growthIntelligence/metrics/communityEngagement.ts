/**
 * Community Engagement Metrics — Phase-1 Read-Only
 * Query: community_ai_actions
 * Filter: status = 'executed'
 * SELECT only, no writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CommunityEngagementResult {
  executedActions: number;
  replies: number;
  likes: number;
  shares: number;
}

export async function getCommunityEngagementMetrics(
  supabase: SupabaseClient,
  organizationId: string
): Promise<CommunityEngagementResult> {
  const empty: CommunityEngagementResult = {
    executedActions: 0,
    replies: 0,
    likes: 0,
    shares: 0,
  };

  try {
    const { data, error } = await supabase
      .from('community_ai_actions')
      .select('action_type')
      .eq('organization_id', organizationId)
      .eq('status', 'executed');

    if (error || !data) return empty;

    const executed = data as Array<{ action_type?: string }>;
    const replies = executed.filter((r) => String(r?.action_type || '').toLowerCase() === 'reply').length;
    const likes = executed.filter((r) => String(r?.action_type || '').toLowerCase() === 'like').length;
    const shares = executed.filter((r) => String(r?.action_type || '').toLowerCase() === 'share').length;

    return {
      executedActions: executed.length,
      replies,
      likes,
      shares,
    };
  } catch {
    return empty;
  }
}
