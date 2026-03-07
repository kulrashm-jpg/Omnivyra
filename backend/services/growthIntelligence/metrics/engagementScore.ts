/**
 * Engagement Score Metrics — Phase-1 Read-Only
 * Join: scheduled_posts + content_analytics
 * SELECT only, no writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EngagementScoreResult {
  totalViews: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  engagementRate: number;
}

function safeNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getEngagementScore(
  supabase: SupabaseClient,
  campaignIds: string[]
): Promise<EngagementScoreResult> {
  const empty: EngagementScoreResult = {
    totalViews: 0,
    totalLikes: 0,
    totalShares: 0,
    totalComments: 0,
    engagementRate: 0,
  };
  if (campaignIds.length === 0) return empty;

  try {
    const { data: posts } = await supabase
      .from('scheduled_posts')
      .select('id')
      .in('campaign_id', campaignIds);

    const postIds = (posts ?? []).map((p: { id: string }) => p.id).filter(Boolean);
    if (postIds.length === 0) return empty;

    const { data: analytics, error } = await supabase
      .from('content_analytics')
      .select('views, likes, shares, comments, engagement_rate')
      .in('scheduled_post_id', postIds);

    if (error || !analytics || analytics.length === 0) return empty;

    let totalViews = 0;
    let totalLikes = 0;
    let totalShares = 0;
    let totalComments = 0;
    let rateSum = 0;

    for (const row of analytics as Array<Record<string, unknown>>) {
      totalViews += safeNum(row.views);
      totalLikes += safeNum(row.likes);
      totalShares += safeNum(row.shares);
      totalComments += safeNum(row.comments);
      rateSum += safeNum(row.engagement_rate);
    }

    const engagementRate =
      analytics.length > 0 ? Math.round((rateSum / analytics.length) * 1000) / 1000 : 0;

    return {
      totalViews,
      totalLikes,
      totalShares,
      totalComments,
      engagementRate,
    };
  } catch {
    return empty;
  }
}
