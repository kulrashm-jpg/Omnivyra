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
  created_at: string;
};

export function isOpportunityType(value: unknown): value is OpportunityType {
  return typeof value === 'string'
    && (OPPORTUNITY_TYPES as readonly string[]).includes(value);
}
