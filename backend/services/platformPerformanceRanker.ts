/**
 * Platform Performance Ranker
 *
 * Ranks platforms for a campaign by average engagement rate (highest → lowest).
 * Used by: decision engine, next campaign planning.
 */

import { supabase } from '../db/supabaseClient';

export type PlatformRank = {
  platform: string;
  avg_engagement_rate: number;
  post_count: number;
};

export async function rankPlatformsByPerformance(campaignId: string): Promise<PlatformRank[]> {
  try {
    const { data, error } = await supabase
      .from('performance_feedback')
      .select('platform, engagement_rate')
      .eq('campaign_id', campaignId);

    if (error || !data?.length) return [];

    const byPlatform: Record<string, { total: number; count: number }> = {};
    for (const row of data as Array<{ platform: string; engagement_rate: number }>) {
      const p = String(row.platform || '').toLowerCase();
      if (!p) continue;
      if (!byPlatform[p]) byPlatform[p] = { total: 0, count: 0 };
      byPlatform[p].total += row.engagement_rate ?? 0;
      byPlatform[p].count += 1;
    }

    return Object.entries(byPlatform)
      .map(([platform, agg]) => ({
        platform,
        avg_engagement_rate: Number((agg.total / agg.count).toFixed(4)),
        post_count: agg.count,
      }))
      .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
  } catch {
    return [];
  }
}
