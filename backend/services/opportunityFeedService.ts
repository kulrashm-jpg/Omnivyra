/**
 * Phase 4 — Opportunity feed service.
 *
 * Two surfaces:
 *
 *   1. `recordOpportunityFromSignal(...)`  — pipeline writer. Called by the
 *      Phase 3 listeningSignalPipeline immediately after a successful
 *      writeLeadSignal. Classifies + clusters + persists one
 *      opportunity_feed_items row. Idempotent on (organization_id,
 *      signal_id) — re-runs are no-ops.
 *
 *   2. `queryOpportunityFeed(...)`         — reader. Filters by type,
 *      platform, confidence, urgency, time window. Returns paged results
 *      with the structured explanation payload intact.
 *
 * Per the Phase 4 prompt: every feed item carries a complete
 * `explanation` JSONB so the UI never surfaces an opaque score. The
 * explanation includes the score breakdown, source trace, matched
 * keywords, moderation outcome, and cluster pointer.
 *
 * Pure additive — does NOT modify lead_signals.
 */

import { ownedDbTable } from '../db/writeOwner';
import { classifyOpportunity } from './opportunityClassifierService';
import { upsertClusterForSignal } from './intentClusteringService';
import {
  publishOpportunityDetectedEvent,
  publishFeedUpdatedEvent,
} from '../events/listeningEvents';
import type {
  OpportunityExplanation,
  OpportunityFeedItem,
  OpportunityType,
} from '../types/opportunityFeed';
import type { RawSignal } from '../types/listeningConnector';
import type { ModerationDecision } from './moderation/moderationGateService';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export type RecordOpportunityInput = {
  organizationId: string;
  signalId: string;
  listeningExecutionId: string;
  raw: RawSignal;
  moderation: ModerationDecision;
  baseScores: {
    intent_score: number;
    urgency_score: number;
    icp_score: number;
    confidence_score: number;
    total_score: number;
  };
};

export type RecordOpportunityResult = {
  feed_item: OpportunityFeedItem;
  created: boolean;
  classification: { opportunity_type: OpportunityType; matched_keywords: string[] };
};

export async function recordOpportunityFromSignal(
  input: RecordOpportunityInput,
): Promise<RecordOpportunityResult | null> {
  // Idempotency — if a feed item already exists for this signal, return it.
  const { data: existing } = await ownedDbTable('opportunity_feed_items')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('signal_id', input.signalId)
    .maybeSingle();
  if (existing) {
    const item = existing as OpportunityFeedItem;
    return {
      feed_item: item,
      created: false,
      classification: {
        opportunity_type: item.opportunity_type,
        matched_keywords: item.matched_keywords,
      },
    };
  }

  const classification = classifyOpportunity(input.raw.content_text);

  // Score derivation. `total_score` is the canonical signal strength;
  // opportunity_score weights it against classification confidence + a
  // keyword-density bonus, with a moderation penalty when flagged.
  const baseTotal = input.baseScores.total_score ?? 0;
  const typeMultiplier = classification.type_multiplier;
  const keywordBonus = Math.min(0.2, classification.matched_keywords.length * 0.05);
  const moderationPenalty = input.moderation.outcome === 'flagged' ? 0.85 : 1.0;
  const opportunityScore = clamp01((baseTotal * typeMultiplier + keywordBonus) * moderationPenalty);

  // Confidence: blend base confidence with the classifier match strength.
  const classifierConfidence = classification.matched_patterns.length > 0
    ? Math.min(1, 0.7 + classification.matched_patterns.length * 0.05)
    : 0.5;
  const confidence = clamp01(
    (input.baseScores.confidence_score ?? 0.5) * 0.5 + classifierConfidence * 0.5,
  );

  // Urgency carries through; comments are slightly more urgent (someone is
  // actively responding to a thread).
  const urgency = clamp01(
    (input.baseScores.urgency_score ?? 0) * (input.raw.is_comment ? 1.05 : 1.0),
  );

  // Cluster — only for non-generic classifications. Generic-interest signals
  // are stored without a cluster so the UI doesn't fan them across spurious
  // groups.
  let clusterId: string | null = null;
  let clusterKey: string | null = null;
  if (classification.opportunity_type !== 'generic_interest') {
    const sourceIdentifier =
      (input.raw.metadata as { subreddit?: string }).subreddit
      ?? (input.raw.metadata as { source_identifier?: string }).source_identifier
      ?? null;
    const cluster = await upsertClusterForSignal({
      organizationId: input.organizationId,
      sourceType: 'listening',
      sourceIdentifier: sourceIdentifier,
      opportunityType: classification.opportunity_type,
      content: input.raw.content_text,
      matchedKeywords: classification.matched_keywords,
      intentScore: input.baseScores.intent_score ?? 0,
      urgencyScore: urgency,
    });
    clusterId = cluster.cluster.id;
    clusterKey = cluster.cluster.cluster_key;
  }

  const sourceIdentifier =
    typeof (input.raw.metadata as { subreddit?: unknown }).subreddit === 'string'
      ? String((input.raw.metadata as { subreddit: string }).subreddit)
      : null;

  const detectedReason = buildDetectedReason(classification.opportunity_type, classification.matched_keywords);

  const explanation: OpportunityExplanation = {
    why: detectedReason,
    matched_keywords: classification.matched_keywords,
    score_breakdown: {
      base_total_score: Number(baseTotal.toFixed(3)),
      type_multiplier: typeMultiplier,
      keyword_match_bonus: Number(keywordBonus.toFixed(3)),
      moderation_penalty: moderationPenalty,
      final: Number(opportunityScore.toFixed(3)),
    },
    source_trace: {
      listening_execution_id: input.listeningExecutionId,
      source_type: 'listening',
      source_identifier: sourceIdentifier,
      platform: input.raw.platform,
      detected_at: input.raw.detected_at,
    },
    moderation: {
      outcome: input.moderation.outcome,
      reasons: input.moderation.reasons,
    },
    cluster: {
      cluster_key: clusterKey,
      cluster_id: clusterId,
    },
  };

  const { data: inserted, error } = await ownedDbTable('opportunity_feed_items')
    .insert({
      organization_id: input.organizationId,
      signal_id: input.signalId,
      cluster_id: clusterId,
      listening_execution_id: input.listeningExecutionId,
      opportunity_type: classification.opportunity_type,
      opportunity_score: Number(opportunityScore.toFixed(3)),
      confidence_score: Number(confidence.toFixed(3)),
      urgency_score: Number(urgency.toFixed(3)),
      source_context: input.raw.metadata,
      detected_reason: detectedReason,
      matched_keywords: classification.matched_keywords,
      platform: input.raw.platform,
      source_identifier: sourceIdentifier,
      author_metadata: input.raw.platform_user_id
        ? {
            platform_user_id: input.raw.platform_user_id,
            author_handle: input.raw.author_handle,
          }
        : {},
      recommendation_context: {},
      explanation,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    // Race condition: another caller wrote the same (org, signal_id) — return
    // the existing row deterministically.
    if (error?.code === '23505') {
      const { data: raced } = await ownedDbTable('opportunity_feed_items')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('signal_id', input.signalId)
        .maybeSingle();
      if (raced) {
        return {
          feed_item: raced as OpportunityFeedItem,
          created: false,
          classification: {
            opportunity_type: classification.opportunity_type,
            matched_keywords: classification.matched_keywords,
          },
        };
      }
    }
    throw new Error(`Failed to record opportunity feed item: ${error?.message ?? 'unknown'}`);
  }

  const feedItem = inserted as OpportunityFeedItem;

  await publishOpportunityDetectedEvent({
    organization_id: feedItem.organization_id,
    opportunity_feed_item_id: feedItem.id,
    signal_id: feedItem.signal_id,
    opportunity_type: feedItem.opportunity_type,
    opportunity_score: feedItem.opportunity_score,
    cluster_id: feedItem.cluster_id,
    occurred_at: feedItem.created_at,
  });

  return {
    feed_item: feedItem,
    created: true,
    classification: {
      opportunity_type: classification.opportunity_type,
      matched_keywords: classification.matched_keywords,
    },
  };
}

function buildDetectedReason(type: OpportunityType, matched: string[]): string {
  const matchHint = matched.length > 0 ? ` (matched: ${matched.slice(0, 3).join(', ')})` : '';
  switch (type) {
    case 'buying_intent':
      return `Explicit buyer-intent language detected${matchHint}.`;
    case 'migration_signal':
      return `Active vendor switching language detected${matchHint}.`;
    case 'competitor_dissatisfaction':
      return `Negative competitor sentiment detected${matchHint}.`;
    case 'product_research':
      return `Product-comparison / research language detected${matchHint}.`;
    case 'integration_need':
      return `Integration / API need detected${matchHint}.`;
    case 'hiring_signal':
      return `Hiring signal detected${matchHint}.`;
    case 'support_frustration':
      return `Support pain detected${matchHint}.`;
    case 'generic_interest':
    default:
      return `Topic match without a specific buyer-intent pattern${matchHint}.`;
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export type OpportunityFeedQuery = {
  organizationId: string;
  types?: OpportunityType[];
  platforms?: string[];
  minConfidence?: number;
  minUrgency?: number;
  sinceIso?: string;
  cursor?: string | null;
  pageSize?: number;
};

export type OpportunityFeedPage = {
  items: OpportunityFeedItem[];
  next_cursor: string | null;
  total: number;
};

export async function queryOpportunityFeed(
  q: OpportunityFeedQuery,
): Promise<OpportunityFeedPage> {
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
  let query = ownedDbTable('opportunity_feed_items')
    .select('*', { count: 'exact' })
    .eq('organization_id', q.organizationId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (q.types && q.types.length > 0) query = query.in('opportunity_type', q.types);
  if (q.platforms && q.platforms.length > 0) query = query.in('platform', q.platforms);
  if (typeof q.minConfidence === 'number') query = query.gte('confidence_score', q.minConfidence);
  if (typeof q.minUrgency === 'number') query = query.gte('urgency_score', q.minUrgency);
  if (q.sinceIso) query = query.gt('created_at', q.sinceIso);
  if (q.cursor) query = query.lt('created_at', q.cursor);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to query opportunity feed: ${error.message}`);

  const items = (data as OpportunityFeedItem[]) ?? [];
  const next_cursor = items.length === pageSize ? items[items.length - 1].created_at : null;
  return { items, next_cursor, total: count ?? items.length };
}

/**
 * Convenience aggregate for the UI's filter chips.
 */
export async function getOpportunityFeedTypeCounts(
  organizationId: string,
): Promise<Record<OpportunityType, number>> {
  const counts: Record<string, number> = {
    buying_intent: 0,
    competitor_dissatisfaction: 0,
    hiring_signal: 0,
    migration_signal: 0,
    product_research: 0,
    integration_need: 0,
    support_frustration: 0,
    generic_interest: 0,
  };
  const { data, error } = await ownedDbTable('opportunity_feed_items')
    .select('opportunity_type')
    .eq('organization_id', organizationId);
  if (error) throw new Error(`Failed to count opportunity types: ${error.message}`);
  for (const row of (data ?? []) as Array<{ opportunity_type: string }>) {
    counts[row.opportunity_type] = (counts[row.opportunity_type] ?? 0) + 1;
  }
  return counts as Record<OpportunityType, number>;
}

export async function publishFeedBatchUpdated(
  organizationId: string,
  itemsAdded: number,
): Promise<void> {
  if (itemsAdded <= 0) return;
  await publishFeedUpdatedEvent({
    organization_id: organizationId,
    items_added: itemsAdded,
    occurred_at: new Date().toISOString(),
  });
}
