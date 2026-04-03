import { supabase } from '../db/supabaseClient';

export type NormalizedFeedbackSignal = {
  id: string;
  company_id: string;
  post_id: string;
  platform: string;
  engagement_type: string;
  engagement_count: number;
};

export async function loadNormalizedFeedbackSignals(lookbackDays = 7): Promise<NormalizedFeedbackSignal[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('engagement_signals')
    .select('id, post_id, platform, engagement_type, engagement_count')
    .gte('captured_at', since)
    .limit(5000);

  if (error) throw new Error(`Failed to load engagement signals: ${error.message}`);

  const postIds = [...new Set(((data ?? []) as Array<{ post_id: string }>).map((row) => row.post_id).filter(Boolean))];
  if (postIds.length === 0) return [];

  const { data: posts, error: postsError } = await supabase
    .from('community_posts')
    .select('id, company_id')
    .in('id', postIds);

  if (postsError) throw new Error(`Failed to load community posts for feedback normalization: ${postsError.message}`);

  const postToCompany = new Map(
    ((posts ?? []) as Array<{ id: string; company_id: string | null }>)
      .filter((row) => Boolean(row.company_id))
      .map((row) => [row.id, String(row.company_id)])
  );

  return ((data ?? []) as Array<{
    id: string;
    post_id: string;
    platform: string;
    engagement_type: string;
    engagement_count: number;
  }>)
    .map((row) => ({
      ...row,
      company_id: postToCompany.get(row.post_id) ?? '',
    }))
    .filter((row) => Boolean(row.company_id))
    .map((row) => ({
      id: row.id,
      company_id: row.company_id,
      post_id: row.post_id,
      platform: String(row.platform || 'unknown').trim().toLowerCase(),
      engagement_type: String(row.engagement_type || 'unknown').trim().toLowerCase(),
      engagement_count: Number(row.engagement_count ?? 0),
    }));
}
