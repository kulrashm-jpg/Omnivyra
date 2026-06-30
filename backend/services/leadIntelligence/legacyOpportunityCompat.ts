/**
 * Repository compatibility reader for the legacy GET /api/active-leads/opportunities contract.
 *
 * The ONLY place that endpoint reads from — it owns the opportunity read by
 * composing the canonical opportunity-feed read (`queryOpportunityFeed`, which
 * reads `opportunity_feed_items`) plus the type-count aggregate, and projects
 * each item through `toLegacyOpportunity`. The projection is field-preserving
 * (full `OpportunityFeedItem`: opportunity_type, explanation, score_breakdown,
 * source_trace, moderation, cluster, matched_keywords, suggested_next_action,
 * resolved_company, resolved_role, priority_score, status, timestamps, metadata),
 * so the contract is byte-identical. Ordering, cursor pagination, filtering and
 * the type_counts aggregate are inherited unchanged from the composed read.
 *
 * A CanonicalLeadView is intentionally NOT used as the carrier: it cannot hold
 * the opportunity-specific/derived fields losslessly, and Phase 6C Regression
 * Protection forbids degrading the contract.
 */

import {
  queryOpportunityFeed,
  getOpportunityFeedTypeCounts,
  type OpportunityFeedPage,
  type OpportunityFeedQuery,
} from '../opportunityFeedService';
import type { OpportunityFeedItem, OpportunityType } from '../../types/opportunityFeed';

/** Field-preserving projection: raw opportunity item → legacy contract (no field loss). */
export function toLegacyOpportunity(item: OpportunityFeedItem): OpportunityFeedItem {
  return { ...item };
}

export async function getOpportunities(params: OpportunityFeedQuery): Promise<OpportunityFeedPage> {
  const page = await queryOpportunityFeed(params);
  return { ...page, items: page.items.map(toLegacyOpportunity) };
}

export async function getOpportunityTypeCounts(companyId: string): Promise<Record<OpportunityType, number>> {
  return getOpportunityFeedTypeCounts(companyId);
}
