export const OPPORTUNITY_TYPES = [
  'buying_intent',
  'competitor_dissatisfaction',
  'hiring_signal',
  'migration_signal',
  'product_research',
  'integration_need',
  'support_frustration',
  'generic_interest',
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export type OpportunityExplanation = {
  /** Plain-English one-liner that the UI surfaces under the card. */
  why: string;
  /** Concrete matched keywords from the classifier. */
  matched_keywords: string[];
  /** The signal score components that drove `opportunity_score`. */
  score_breakdown: {
    base_total_score: number;
    type_multiplier: number;
    keyword_match_bonus: number;
    moderation_penalty: number;
    final: number;
  };
  /** Provenance — execution + connector context. */
  source_trace: {
    listening_execution_id: string | null;
    source_type: string | null;
    source_identifier: string | null;
    platform: string;
    detected_at: string | null;
  };
  /** Moderation outcome propagated from the moderation gate. */
  moderation: {
    outcome: 'approved' | 'flagged' | 'blocked' | 'requires_review';
    reasons: string[];
  };
  /** Optional cluster pointer so the UI can group cards. */
  cluster: {
    cluster_key: string | null;
    cluster_id: string | null;
  };
};

export type OpportunityFeedItem = {
  id: string;
  organization_id: string;
  signal_id: string;
  cluster_id: string | null;
  listening_execution_id: string | null;
  opportunity_type: OpportunityType;
  opportunity_score: number;
  confidence_score: number;
  urgency_score: number;
  source_context: Record<string, unknown>;
  detected_reason: string;
  matched_keywords: string[];
  platform: string;
  source_identifier: string | null;
  author_metadata: Record<string, unknown>;
  recommendation_context: Record<string, unknown>;
  explanation: OpportunityExplanation;
  /**
   * PR-OPA-1 — Verbatim excerpt of the post / comment / discussion that
   * triggered the classification. Max 300 chars, ellipsis-truncated.
   * Nullable so legacy rows (pre-migration) still parse.
   */
  signal_excerpt: string | null;
  /**
   * PR-OPA-2 — Recommended next step for the operator. Derived at read
   * time from `opportunity_type` via a deterministic rule map; never
   * persisted. Null for `generic_interest` (no specific guidance) or
   * when the row was fetched through a path that doesn't enrich it.
   */
  suggested_next_action: string | null;
  /**
   * PR-OPA-3 — Resolved company name (e.g. "Acme Corp"). Derived at
   * read time from author_metadata using platform-specific rules
   * (LinkedIn / GitHub / X only). Null when not resolvable or when
   * the platform isn't covered.
   */
  resolved_company: string | null;
  /**
   * PR-OPA-3 — Resolved role / title (e.g. "VP Revenue Operations").
   * Same derivation rules as resolved_company.
   */
  resolved_role: string | null;
  /**
   * PR-OPA-3 — Confidence of the identity resolution. UI hides the
   * identity block when this is 'low' or null.
   */
  identity_confidence: IdentityConfidence | null;
  /**
   * PR-OPA-6 — Read-time-derived value-aware priority for queue
   * ordering. Composite of opportunity_score × type weight,
   * confidence, urgency, identity bonus, evidence bonus, and a
   * 2-day-half-life recency decay. Never persisted; injected by the
   * reader. Null when fetched through a path that doesn't enrich it.
   */
  priority_score: number | null;
  created_at: string;
};

/** PR-OPA-1 — hard cap on the persisted excerpt length. */
export const SIGNAL_EXCERPT_MAX_LENGTH = 300;

/** PR-OPA-3 — identity-enrichment confidence. */
export type IdentityConfidence = 'high' | 'medium' | 'low';

/**
 * PR-OPA-6 — per-type value weighting used by the priority ranker.
 * Reflects operator value-per-opportunity: buying_intent and migration
 * signals are most actionable; generic_interest least.
 */
export const TYPE_VALUE_MULTIPLIER: Record<OpportunityType, number> = {
  buying_intent:              1.0,
  migration_signal:           0.9,
  competitor_dissatisfaction: 0.8,
  integration_need:           0.8,
  product_research:           0.7,
  hiring_signal:              0.6,
  support_frustration:        0.5,
  generic_interest:           0.2,
};

export function isOpportunityType(value: unknown): value is OpportunityType {
  return typeof value === 'string'
    && (OPPORTUNITY_TYPES as readonly string[]).includes(value);
}
