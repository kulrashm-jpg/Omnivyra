/**
 * Engagement Polling Job Processor
 *
 * Selects recently published posts (last 30 days), calls ingestComments for each.
 * One failure does not stop the loop; summary returned.
 * No evaluation/action/notification changes — ingestion only.
 */

import { supabase } from '../../db/supabaseClient';
import { ingestComments } from '../../services/engagementIngestionService';

const BATCH_SIZE = 50;
const PUBLISHED_WITHIN_DAYS = 30;

export type EngagementPollingResult = {
  total_processed: number;
  total_ingested_comments: number;
  failures_count: number;
};

/**
 * Process one engagement polling job: select published posts, ingest comments for each.
 */
export async function processEngagementPollingJob(): Promise<EngagementPollingResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PUBLISHED_WITHIN_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const { data: posts, error } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('status', 'published')
    .not('platform_post_id', 'is', null)
    .gte('published_at', cutoffIso)
    .order('published_at', { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[engagementPolling] Query error:', error.message);
    throw new Error(`Failed to query scheduled_posts: ${error.message}`);
  }

  const list = posts ?? [];
  let totalIngested = 0;
  let failuresCount = 0;

  for (const post of list) {
    try {
      const result = await ingestComments(post.id);
      if (result.success) {
        totalIngested += result.ingested;
      } else {
        failuresCount += 1;
        console.warn(`[engagementPolling] ingest failed for ${post.id}:`, result.error);
      }
    } catch (e: any) {
      failuresCount += 1;
      console.warn(`[engagementPolling] ingest error for ${post.id}:`, e?.message);
    }
  }

  const summary: EngagementPollingResult = {
    total_processed: list.length,
    total_ingested_comments: totalIngested,
    failures_count: failuresCount,
  };

  console.log(
    `[engagementPolling] total_processed=${summary.total_processed} total_ingested_comments=${summary.total_ingested_comments} failures_count=${summary.failures_count}`
  );

  return summary;
}
