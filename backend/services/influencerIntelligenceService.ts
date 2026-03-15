/**
 * Influencer Intelligence Service
 *
 * Detects high-impact participants across social and community platforms.
 * Uses engagement_messages, engagement_threads, engagement_opportunities, engagement_lead_signals.
 */

import { supabase } from '../db/supabaseClient';

const MESSAGE_WEIGHT = 0.25;
const THREAD_WEIGHT = 0.2;
const REPLY_WEIGHT = 0.2;
const RECOMMENDATION_WEIGHT = 0.2;
const QUESTION_ANSWERS_WEIGHT = 0.15;

export type InfluencerRow = {
  id: string;
  organization_id: string;
  author_id: string;
  author_name: string | null;
  platform: string;
  message_count: number;
  thread_count: number;
  reply_count: number;
  recommendation_mentions: number;
  question_answers: number;
  engagement_score: number;
  influence_score: number;
  last_active_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type InfluencerSummary = {
  id: string;
  author_id: string;
  author_name: string | null;
  platform: string;
  message_count: number;
  thread_count: number;
  reply_count: number;
  recommendation_mentions: number;
  question_answers: number;
  influence_score: number;
  last_active_at: string | null;
};

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

/**
 * Compute influence score from normalized metrics.
 */
export function computeInfluenceScore(metrics: {
  message_count: number;
  thread_count: number;
  reply_count: number;
  recommendation_mentions: number;
  question_answers: number;
  max_message_count: number;
  max_thread_count: number;
  max_reply_count: number;
  max_recommendation_mentions: number;
  max_question_answers: number;
}): number {
  const m = normalize(metrics.message_count, metrics.max_message_count);
  const t = normalize(metrics.thread_count, metrics.max_thread_count);
  const r = normalize(metrics.reply_count, metrics.max_reply_count);
  const rec = normalize(metrics.recommendation_mentions, metrics.max_recommendation_mentions);
  const q = normalize(metrics.question_answers, metrics.max_question_answers);
  return (
    MESSAGE_WEIGHT * m +
    THREAD_WEIGHT * t +
    REPLY_WEIGHT * r +
    RECOMMENDATION_WEIGHT * rec +
    QUESTION_ANSWERS_WEIGHT * q
  );
}

/**
 * Aggregate authors and compute influence scores for an organization.
 * Upserts into influencer_intelligence.
 */
export async function calculateInfluencers(organizationId: string): Promise<{
  processed: number;
  upserted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const LOOKBACK_DAYS = 90;
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Get threads for this org
  const { data: threads, error: thrError } = await supabase
    .from('engagement_threads')
    .select('id')
    .eq('organization_id', organizationId)
    .not('organization_id', 'is', null);

  if (thrError) {
    return { processed: 0, upserted: 0, errors: [thrError.message] };
  }
  const threadIds = (threads ?? []).map((t: { id: string }) => t.id);
  if (threadIds.length === 0) {
    return { processed: 0, upserted: 0, errors: [] };
  }

  // Messages: author_id, thread_id, platform, parent_message_id, created_at
  const { data: messages, error: msgError } = await supabase
    .from('engagement_messages')
    .select('id, author_id, thread_id, platform, parent_message_id, created_at, platform_created_at')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff)
    .not('author_id', 'is', null);

  if (msgError) {
    return { processed: 0, upserted: 0, errors: [msgError.message] };
  }
  const rows = (messages ?? []) as Array<{
    id: string;
    author_id: string;
    thread_id: string;
    platform: string;
    parent_message_id: string | null;
    created_at?: string | null;
    platform_created_at?: string | null;
  }>;

  if (rows.length === 0) {
    return { processed: 0, upserted: 0, errors: [] };
  }

  const authorIds = [...new Set(rows.map((r) => r.author_id))];

  // Fetch author names
  const { data: authors } = await supabase
    .from('engagement_authors')
    .select('id, username, display_name')
    .in('id', authorIds);
  const authorByName = new Map<string, string>();
  for (const a of authors ?? []) {
    const name = (a as { display_name?: string; username?: string }).display_name ?? (a as { username?: string }).username ?? '';
    authorByName.set((a as { id: string }).id, name);
  }

  // Aggregations per (author_id, platform)
  const byAuthorPlatform = new Map<
    string,
    {
      message_count: number;
      thread_count: Set<string>;
      reply_count: number;
      last_at: string | null;
    }
  >();

  for (const r of rows) {
    const key = `${r.author_id}::${r.platform}`;
    let agg = byAuthorPlatform.get(key);
    if (!agg) {
      agg = { message_count: 0, thread_count: new Set(), reply_count: 0, last_at: null };
      byAuthorPlatform.set(key, agg);
    }
    agg.message_count++;
    agg.thread_count.add(r.thread_id);
    if (r.parent_message_id) agg.reply_count++;
    const at = r.platform_created_at ?? r.created_at;
    if (at && (!agg.last_at || at > agg.last_at)) agg.last_at = at;
  }

  // Engagement opportunities: recommendation_mentions, question_answers
  const recByKey = new Map<string, number>();
  const qaByKey = new Map<string, number>();
  const { data: oppRows } = await supabase
    .from('engagement_opportunities')
    .select('author_id, opportunity_type, platform')
    .in('source_thread_id', threadIds)
    .gte('detected_at', cutoff)
    .not('author_id', 'is', null);

  for (const o of oppRows ?? []) {
    const auth = (o as { author_id: string }).author_id;
    const type = (o as { opportunity_type: string }).opportunity_type;
    const platform = (o as { platform?: string }).platform ?? 'unknown';
    const key = `${auth}::${platform}`;
    if (type === 'recommendation_request') {
      recByKey.set(key, (recByKey.get(key) ?? 0) + 1);
    }
    if (type === 'problem_discussion') {
      qaByKey.set(key, (qaByKey.get(key) ?? 0) + 1);
    }
  }

  // Max values for normalization
  let maxMsg = 0,
    maxThread = 0,
    maxReply = 0,
    maxRec = 0,
    maxQa = 0;
  const combined = new Map<
    string,
    {
      message_count: number;
      thread_count: number;
      reply_count: number;
      recommendation_mentions: number;
      question_answers: number;
      last_at: string | null;
      author_id: string;
      platform: string;
    }
  >();

  for (const [key, agg] of byAuthorPlatform) {
    const [author_id, platform] = key.split('::');
    const recommendation_mentions = recByKey.get(key) ?? 0;
    const question_answers = qaByKey.get(key) ?? 0;
    combined.set(key, {
      author_id,
      platform,
      message_count: agg.message_count,
      thread_count: agg.thread_count.size,
      reply_count: agg.reply_count,
      recommendation_mentions,
      question_answers,
      last_at: agg.last_at,
    });
    maxMsg = Math.max(maxMsg, agg.message_count);
    maxThread = Math.max(maxThread, agg.thread_count.size);
    maxReply = Math.max(maxReply, agg.reply_count);
    maxRec = Math.max(maxRec, recommendation_mentions);
    maxQa = Math.max(maxQa, question_answers);
  }

  // Compute scores and upsert
  let upserted = 0;
  for (const [key, c] of combined) {
    const score = computeInfluenceScore({
      message_count: c.message_count,
      thread_count: c.thread_count,
      reply_count: c.reply_count,
      recommendation_mentions: c.recommendation_mentions,
      question_answers: c.question_answers,
      max_message_count: maxMsg || 1,
      max_thread_count: maxThread || 1,
      max_reply_count: maxReply || 1,
      max_recommendation_mentions: maxRec || 1,
      max_question_answers: maxQa || 1,
    });

    const authorName = authorByName.get(c.author_id) ?? null;
    const { error: upsertError } = await supabase.from('influencer_intelligence').upsert(
      {
        organization_id: organizationId,
        author_id: c.author_id,
        author_name: authorName,
        platform: c.platform,
        message_count: c.message_count,
        thread_count: c.thread_count,
        reply_count: c.reply_count,
        recommendation_mentions: c.recommendation_mentions,
        question_answers: c.question_answers,
        engagement_score: score,
        influence_score: score,
        last_active_at: c.last_at,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'organization_id,author_id,platform',
        ignoreDuplicates: false,
      }
    );

    if (upsertError) {
      errors.push(upsertError.message);
    } else {
      upserted++;
    }
  }

  return { processed: rows.length, upserted, errors };
}

/**
 * Get top influencers for an organization.
 */
export async function getTopInfluencers(
  organizationId: string,
  limit = 10
): Promise<InfluencerSummary[]> {
  const { data, error } = await supabase
    .from('influencer_intelligence')
    .select('id, author_id, author_name, platform, message_count, thread_count, reply_count, recommendation_mentions, question_answers, influence_score, last_active_at')
    .eq('organization_id', organizationId)
    .order('influence_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[influencerIntelligence] getTopInfluencers error', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    author_id: (r as { author_id: string }).author_id,
    author_name: (r as { author_name?: string }).author_name ?? null,
    platform: (r as { platform: string }).platform,
    message_count: (r as { message_count: number }).message_count ?? 0,
    thread_count: (r as { thread_count: number }).thread_count ?? 0,
    reply_count: (r as { reply_count: number }).reply_count ?? 0,
    recommendation_mentions: (r as { recommendation_mentions: number }).recommendation_mentions ?? 0,
    question_answers: (r as { question_answers: number }).question_answers ?? 0,
    influence_score: Number((r as { influence_score: number }).influence_score ?? 0),
    last_active_at: (r as { last_active_at?: string }).last_active_at ?? null,
  }));
}

/**
 * Get influencers filtered by platform.
 */
export async function getInfluencersByPlatform(
  organizationId: string,
  platform: string
): Promise<InfluencerSummary[]> {
  const { data, error } = await supabase
    .from('influencer_intelligence')
    .select('id, author_id, author_name, platform, message_count, thread_count, reply_count, recommendation_mentions, question_answers, influence_score, last_active_at')
    .eq('organization_id', organizationId)
    .eq('platform', platform)
    .order('influence_score', { ascending: false });

  if (error) {
    console.warn('[influencerIntelligence] getInfluencersByPlatform error', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    author_id: (r as { author_id: string }).author_id,
    author_name: (r as { author_name?: string }).author_name ?? null,
    platform: (r as { platform: string }).platform,
    message_count: (r as { message_count: number }).message_count ?? 0,
    thread_count: (r as { thread_count: number }).thread_count ?? 0,
    reply_count: (r as { reply_count: number }).reply_count ?? 0,
    recommendation_mentions: (r as { recommendation_mentions: number }).recommendation_mentions ?? 0,
    question_answers: (r as { question_answers: number }).question_answers ?? 0,
    influence_score: Number((r as { influence_score: number }).influence_score ?? 0),
    last_active_at: (r as { last_active_at?: string }).last_active_at ?? null,
  }));
}
