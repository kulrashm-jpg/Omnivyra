/**
 * Phase 4 — Deterministic intent clustering.
 *
 * No vector DB. No AI. The cluster_key is a short SHA-256 of:
 *   (source_identifier|opportunity_type|top_keyword_bucket)
 *
 * Where `top_keyword_bucket` is the alphabetically-sorted top-3 most-frequent
 * tokens from `matched_keywords ∪ content tokens` (sub-string normalised).
 *
 * This guarantees:
 *   • Same signal landing in the same cluster regardless of fetch order.
 *   • Bounded cluster size (we only store the aggregate row; the membership
 *     is implicit via opportunity_feed_items.cluster_id).
 *   • No clustering loop — each new signal is upserted once.
 *
 * publishClusterCreatedEvent fires only on first creation; subsequent
 * signals into an existing cluster bump signal_count + last_seen_at without
 * re-emitting cluster.created.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import type { OpportunityType } from '../types/opportunityFeed';
import type { SignalIntentCluster } from '../types/intentCluster';
import { publishClusterCreatedEvent } from '../events/listeningEvents';

const TOP_KEYWORD_BUCKET_SIZE = 3;

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the','this','that','have','has','from','with','your','what','which','when','where',
  'just','really','about','would','could','should','their','there','those','these',
  'thing','things','some','someone','anyone','everyone','really','please','help',
  'thanks','thank','also','than','then','they','them','were','been','because',
]);

function pickTopKeywords(content: string, matched: string[]): string[] {
  const counts = new Map<string, number>();
  for (const m of matched) {
    for (const t of tokenise(m)) counts.set(t, (counts.get(t) ?? 0) + 2);
  }
  for (const t of tokenise(content).slice(0, 200)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_KEYWORD_BUCKET_SIZE)
    .map(([k]) => k)
    .sort();
}

export function buildClusterKey(args: {
  sourceIdentifier: string | null;
  opportunityType: OpportunityType;
  topKeywords: string[];
}): string {
  const canonical = `${(args.sourceIdentifier ?? 'unknown').toLowerCase()}|${args.opportunityType}|${[...args.topKeywords].sort().join(',')}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

export type UpsertClusterInput = {
  organizationId: string;
  sourceType: string | null;
  sourceIdentifier: string | null;
  opportunityType: OpportunityType;
  content: string;
  matchedKeywords: string[];
  intentScore: number;
  urgencyScore: number;
};

export type UpsertClusterResult = {
  cluster: SignalIntentCluster;
  created: boolean;
};

export async function upsertClusterForSignal(
  input: UpsertClusterInput,
): Promise<UpsertClusterResult> {
  const topKeywords = pickTopKeywords(input.content, input.matchedKeywords);
  const clusterKey = buildClusterKey({
    sourceIdentifier: input.sourceIdentifier,
    opportunityType: input.opportunityType,
    topKeywords,
  });

  // Read first.
  const { data: existing } = await ownedDbTable('signal_intent_clusters')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('cluster_key', clusterKey)
    .maybeSingle();

  if (existing) {
    const row = existing as SignalIntentCluster;
    const newCount = row.signal_count + 1;
    const newAvgIntent = ((row.avg_intent_score ?? 0) * row.signal_count + input.intentScore) / newCount;
    const newAvgUrgency = ((row.avg_urgency_score ?? 0) * row.signal_count + input.urgencyScore) / newCount;
    const { data: updated, error } = await ownedDbTable('signal_intent_clusters')
      .update({
        signal_count: newCount,
        avg_intent_score: Number(newAvgIntent.toFixed(3)),
        avg_urgency_score: Number(newAvgUrgency.toFixed(3)),
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error || !updated) {
      throw new Error(`Failed to bump cluster: ${error?.message ?? 'unknown'}`);
    }
    return { cluster: updated as SignalIntentCluster, created: false };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertErr } = await ownedDbTable('signal_intent_clusters')
    .insert({
      organization_id: input.organizationId,
      cluster_key: clusterKey,
      source_type: input.sourceType,
      source_identifier: input.sourceIdentifier,
      opportunity_type: input.opportunityType,
      top_keywords: topKeywords,
      signal_count: 1,
      avg_intent_score: Number(input.intentScore.toFixed(3)),
      avg_urgency_score: Number(input.urgencyScore.toFixed(3)),
      first_seen_at: now,
      last_seen_at: now,
      metadata: {},
    })
    .select('*')
    .single();
  if (insertErr || !inserted) {
    // 23505 — race condition: another caller just created the cluster.
    // Re-read and treat as existing.
    if (insertErr?.code === '23505') {
      const { data: raced } = await ownedDbTable('signal_intent_clusters')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('cluster_key', clusterKey)
        .maybeSingle();
      if (raced) return { cluster: raced as SignalIntentCluster, created: false };
    }
    throw new Error(`Failed to create cluster: ${insertErr?.message ?? 'unknown'}`);
  }
  const cluster = inserted as SignalIntentCluster;
  await publishClusterCreatedEvent({
    organization_id: cluster.organization_id,
    cluster_id: cluster.id,
    cluster_key: cluster.cluster_key,
    opportunity_type: cluster.opportunity_type,
    occurred_at: now,
  });
  return { cluster, created: true };
}
