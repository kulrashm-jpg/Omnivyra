/**
 * Publishing Success Metrics — Phase-1 Read-Only
 * Query: scheduled_posts
 * SELECT only, no writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublishingSuccessResult {
  published: number;
  failed: number;
  successRate: number;
}

export async function getPublishingSuccessMetrics(
  supabase: SupabaseClient,
  campaignIds: string[]
): Promise<PublishingSuccessResult> {
  const empty: PublishingSuccessResult = { published: 0, failed: 0, successRate: 0 };
  if (campaignIds.length === 0) return empty;

  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('status')
      .in('campaign_id', campaignIds);

    if (error || !data) return empty;

    const published = data.filter(
      (r: { status?: string }) => String(r?.status || '').toLowerCase() === 'published'
    ).length;
    const failed = data.filter(
      (r: { status?: string }) => String(r?.status || '').toLowerCase() === 'failed'
    ).length;

    const total = published + failed;
    const successRate = total > 0 ? Math.round((published / total) * 1000) / 1000 : 0;

    return { published, failed, successRate };
  } catch {
    return empty;
  }
}
