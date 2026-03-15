/**
 * Buyer Intent Intelligence Service
 *
 * Aggregates engagement_opportunities by author + platform.
 * Signals: buying_intent, recommendation_request, product_comparison, problem_discussion
 */

import { supabase } from '../db/supabaseClient';

const BUYING_WEIGHT = 0.35;
const RECOMMENDATION_WEIGHT = 0.25;
const COMPARISON_WEIGHT = 0.2;
const PROBLEM_WEIGHT = 0.2;

function normalize(v: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, v / max);
}

/**
 * Compute intent score from signal counts.
 */
export function computeIntentScore(counts: {
  buying_intent: number;
  recommendation_request: number;
  product_comparison: number;
  problem_discussion: number;
  max_buying: number;
  max_rec: number;
  max_comp: number;
  max_prob: number;
}): number {
  const b = normalize(counts.buying_intent, counts.max_buying);
  const r = normalize(counts.recommendation_request, counts.max_rec);
  const c = normalize(counts.product_comparison, counts.max_comp);
  const p = normalize(counts.problem_discussion, counts.max_prob);
  return BUYING_WEIGHT * b + RECOMMENDATION_WEIGHT * r + COMPARISON_WEIGHT * c + PROBLEM_WEIGHT * p;
}

export type BuyerIntentAccount = {
  id: string;
  author_id: string;
  author_name: string | null;
  platform: string;
  message_count: number;
  intent_signals: number;
  recommendation_requests: number;
  comparison_mentions: number;
  intent_score: number;
  last_detected_at: string | null;
};

/**
 * Calculate and upsert buyer intent accounts for an organization.
 */
export async function calculateBuyerIntentAccounts(organizationId: string): Promise<{
  processed: number;
  upserted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const LOOKBACK_DAYS = 30;
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: opps, error: oppError } = await supabase
    .from('engagement_opportunities')
    .select('author_id, opportunity_type, platform, source_message_id, detected_at')
    .eq('organization_id', organizationId)
    .gte('detected_at', cutoff)
    .not('author_id', 'is', null);

  if (oppError) {
    return { processed: 0, upserted: 0, errors: [oppError.message] };
  }

  const rows = (opps ?? []) as Array<{
    author_id: string;
    opportunity_type: string;
    platform: string;
    source_message_id: string;
    detected_at?: string;
  }>;
  if (rows.length === 0) return { processed: 0, upserted: 0, errors: [] };

  const byKey = new Map<
    string,
    {
      author_id: string;
      platform: string;
      message_ids: Set<string>;
      buying_intent: number;
      recommendation_request: number;
      product_comparison: number;
      problem_discussion: number;
      last_at: string | null;
    }
  >();

  for (const r of rows) {
    const key = `${r.author_id}::${r.platform}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        author_id: r.author_id,
        platform: r.platform,
        message_ids: new Set(),
        buying_intent: 0,
        recommendation_request: 0,
        product_comparison: 0,
        problem_discussion: 0,
        last_at: null,
      };
      byKey.set(key, agg);
    }
    agg.message_ids.add(r.source_message_id);
    if (r.opportunity_type === 'buying_intent') agg.buying_intent++;
    if (r.opportunity_type === 'recommendation_request') agg.recommendation_request++;
    if (r.opportunity_type === 'product_comparison') agg.product_comparison++;
    if (r.opportunity_type === 'problem_discussion') agg.problem_discussion++;
    if (r.detected_at && (!agg.last_at || r.detected_at > agg.last_at)) agg.last_at = r.detected_at;
  }

  let maxB = 0,
    maxR = 0,
    maxC = 0,
    maxP = 0;
  for (const a of byKey.values()) {
    maxB = Math.max(maxB, a.buying_intent);
    maxR = Math.max(maxR, a.recommendation_request);
    maxC = Math.max(maxC, a.product_comparison);
    maxP = Math.max(maxP, a.problem_discussion);
  }
  maxB = maxB || 1;
  maxR = maxR || 1;
  maxC = maxC || 1;
  maxP = maxP || 1;

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const { data: authors } = await supabase
    .from('engagement_authors')
    .select('id, username, display_name')
    .in('id', authorIds);
  const authorMap = new Map(
    (authors ?? []).map((a: { id: string; username?: string; display_name?: string }) => [
      a.id,
      (a as { display_name?: string }).display_name ?? (a as { username?: string }).username ?? 'Unknown',
    ])
  );

  let upserted = 0;
  for (const agg of byKey.values()) {
    const score = computeIntentScore({
      buying_intent: agg.buying_intent,
      recommendation_request: agg.recommendation_request,
      product_comparison: agg.product_comparison,
      problem_discussion: agg.problem_discussion,
      max_buying: maxB,
      max_rec: maxR,
      max_comp: maxC,
      max_prob: maxP,
    });
    const intentSignals =
      agg.buying_intent + agg.recommendation_request + agg.product_comparison + agg.problem_discussion;

    const { error: upsertError } = await supabase.from('buyer_intent_accounts').upsert(
      {
        organization_id: organizationId,
        author_id: agg.author_id,
        author_name: authorMap.get(agg.author_id) ?? null,
        platform: agg.platform,
        message_count: agg.message_ids.size,
        intent_signals: intentSignals,
        recommendation_requests: agg.recommendation_request,
        comparison_mentions: agg.product_comparison,
        intent_score: score,
        last_detected_at: agg.last_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,author_id,platform', ignoreDuplicates: false }
    );
    if (upsertError) errors.push(upsertError.message);
    else upserted++;
  }

  return { processed: rows.length, upserted, errors };
}

/**
 * Get top buyer intent accounts.
 */
export async function getBuyerIntentAccounts(
  organizationId: string,
  limit = 20
): Promise<BuyerIntentAccount[]> {
  const { data, error } = await supabase
    .from('buyer_intent_accounts')
    .select('id, author_id, author_name, platform, message_count, intent_signals, recommendation_requests, comparison_mentions, intent_score, last_detected_at')
    .eq('organization_id', organizationId)
    .order('intent_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[buyerIntentIntelligence] getBuyerIntentAccounts error', error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: (r as { id: string }).id,
    author_id: (r as { author_id: string }).author_id,
    author_name: (r as { author_name?: string }).author_name ?? null,
    platform: (r as { platform: string }).platform,
    message_count: (r as { message_count: number }).message_count ?? 0,
    intent_signals: (r as { intent_signals: number }).intent_signals ?? 0,
    recommendation_requests: (r as { recommendation_requests: number }).recommendation_requests ?? 0,
    comparison_mentions: (r as { comparison_mentions: number }).comparison_mentions ?? 0,
    intent_score: Number((r as { intent_score: number }).intent_score ?? 0),
    last_detected_at: (r as { last_detected_at?: string }).last_detected_at ?? null,
  }));
}
