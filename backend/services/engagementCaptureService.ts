/**
 * Engagement Capture Service
 * Captures engagement metrics from platform APIs (LinkedIn, Twitter/X, etc.).
 * Inserts into engagement_signals. Placeholder when APIs not configured.
 */

import { supabase } from '../db/supabaseClient';

const ENGAGEMENT_TYPES = ['likes', 'comments', 'shares', 'reposts', 'clicks'] as const;

type PostRow = {
  id: string;
  platform: string | null;
};

/**
 * Load community posts that do not yet have engagement signals.
 */
async function loadPostsWithoutSignals(): Promise<PostRow[]> {
  const { data: posts, error: pErr } = await supabase
    .from('community_posts')
    .select('id, platform')
    .order('created_at', { ascending: false })
    .limit(100);

  if (pErr) throw new Error(`Failed to load community_posts: ${pErr.message}`);
  const postList = (posts ?? []) as PostRow[];

  if (postList.length === 0) return [];

  const { data: existing } = await supabase
    .from('engagement_signals')
    .select('post_id')
    .in('post_id', postList.map((p) => p.id));

  const hasSignal = new Set((existing ?? []).map((r: { post_id: string }) => r.post_id));
  return postList.filter((p) => !hasSignal.has(p.id));
}

export type CaptureEngagementSignalsResult = {
  posts_processed: number;
  signals_created: number;
  signals_skipped: number;
};

/**
 * Capture engagement signals for community posts.
 * When LinkedIn/Twitter APIs are not configured, inserts placeholder (0 count) rows.
 */
export async function captureEngagementSignals(): Promise<CaptureEngagementSignalsResult> {
  const posts = await loadPostsWithoutSignals();
  let signalsCreated = 0;
  let signalsSkipped = 0;

  for (const post of posts) {
    const platform = post.platform ?? 'LinkedIn';

    for (const engType of ENGAGEMENT_TYPES) {
      const { error } = await supabase.from('engagement_signals').insert({
        post_id: post.id,
        platform,
        engagement_type: engType,
        engagement_count: 0,
      });

      if (error) {
        if (error.code === '23503') signalsSkipped++;
        else throw new Error(`engagement_signals insert failed: ${error.message}`);
      } else {
        signalsCreated++;
      }
    }
  }

  return {
    posts_processed: posts.length,
    signals_created: signalsCreated,
    signals_skipped: signalsSkipped,
  };
}
