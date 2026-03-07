/**
 * Content Velocity Metrics — Phase-1 Read-Only
 * Queries: daily_content_plans, scheduled_posts
 * SELECT only, no writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ContentVelocityResult {
  plannedPosts: number;
  scheduledPosts: number;
  publishedPosts: number;
}

export async function getContentVelocityMetrics(
  supabase: SupabaseClient,
  campaignIds: string[]
): Promise<ContentVelocityResult> {
  const empty: ContentVelocityResult = { plannedPosts: 0, scheduledPosts: 0, publishedPosts: 0 };
  if (campaignIds.length === 0) return empty;

  try {
    const [dailyResult, scheduledResult] = await Promise.all([
      supabase
        .from('daily_content_plans')
        .select('id', { count: 'exact', head: true })
        .in('campaign_id', campaignIds),

      supabase
        .from('scheduled_posts')
        .select('id, status')
        .in('campaign_id', campaignIds),
    ]);

    const plannedPosts = (dailyResult as { count?: number }).count ?? 0;

    const scheduledRows = scheduledResult.data ?? [];
    const scheduledPosts = scheduledRows.filter(
      (r: { status?: string }) => String(r?.status || '').toLowerCase() === 'scheduled'
    ).length;
    const publishedPosts = scheduledRows.filter(
      (r: { status?: string }) => String(r?.status || '').toLowerCase() === 'published'
    ).length;

    return {
      plannedPosts,
      scheduledPosts,
      publishedPosts,
    };
  } catch {
    return empty;
  }
}
