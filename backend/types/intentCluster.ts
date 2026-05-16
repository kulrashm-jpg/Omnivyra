import type { OpportunityType } from './opportunityFeed';

export type SignalIntentCluster = {
  id: string;
  organization_id: string;
  cluster_key: string;
  source_type: string | null;
  source_identifier: string | null;
  opportunity_type: OpportunityType;
  top_keywords: string[];
  signal_count: number;
  avg_intent_score: number | null;
  avg_urgency_score: number | null;
  first_seen_at: string;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
