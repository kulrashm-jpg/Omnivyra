export const RECOMMENDATION_STATUSES = [
  'suggested',
  'approved',
  'rejected',
  'dismissed',
  'activated',
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_CATEGORIES = [
  'industry_match',
  'icp_overlap',
  'competitor_adjacent',
  'keyword_density',
  'buyer_intent_hotspot',
  'support_complaint_hotspot',
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export type CommunityRecommendation = {
  id: string;
  organization_id: string;
  source_type: string;
  source_identifier: string;
  display_name: string;
  recommendation_reason: string;
  recommendation_category: RecommendationCategory | null;
  confidence_score: number;
  estimated_signal_quality: number;
  estimated_volume: number;
  estimated_cost: number;
  strategic_relevance: number;
  related_keywords: string[];
  related_competitors: string[];
  recommendation_status: RecommendationStatus;
  source_metadata: Record<string, unknown>;
  activated_listening_source_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  dismissed_at: string | null;
  rejected_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isRecommendationStatus(value: unknown): value is RecommendationStatus {
  return typeof value === 'string'
    && (RECOMMENDATION_STATUSES as readonly string[]).includes(value);
}
