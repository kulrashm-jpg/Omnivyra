/**
 * Opportunity Radar Service
 * Cross-thread opportunity counts across the organization.
 */

import { supabase } from '../db/supabaseClient';

const BUYING_INTENT_LEAD_INTENTS = [
  'pricing_inquiry',
  'demo_request',
  'trial_interest',
] as const;

export type OpportunityRadarStats = {
  competitor_complaints: number;
  recommendation_requests: number;
  product_comparisons: number;
  buying_intent: number;
  window_hours: number;
};

/**
 * Returns cross-thread opportunity counts for the last N hours.
 * Queries run in parallel for performance (< 100ms target).
 */
export async function getOpportunityRadarStats(
  organizationId: string,
  windowHours: number = 24
): Promise<OpportunityRadarStats> {
  if (!organizationId) {
    return {
      competitor_complaints: 0,
      recommendation_requests: 0,
      product_comparisons: 0,
      buying_intent: 0,
      window_hours: windowHours,
    };
  }

  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const [
    competitorResult,
    recommendationResult,
    comparisonResult,
    buyingIntentResult,
  ] = await Promise.all([
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('opportunity_type', 'competitor_complaint')
      .eq('resolved', false)
      .gte('detected_at', windowStart),
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('opportunity_type', 'recommendation_request')
      .eq('resolved', false)
      .gte('detected_at', windowStart),
    supabase
      .from('engagement_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('opportunity_type', 'product_comparison')
      .eq('resolved', false)
      .gte('detected_at', windowStart),
    supabase
      .from('engagement_lead_signals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('lead_intent', [...BUYING_INTENT_LEAD_INTENTS])
      .gte('detected_at', windowStart),
  ]);

  if (competitorResult.error) {
    console.warn('[opportunityRadar] competitor_complaint count error', competitorResult.error.message);
  }
  if (recommendationResult.error) {
    console.warn('[opportunityRadar] recommendation_request count error', recommendationResult.error.message);
  }
  if (comparisonResult.error) {
    console.warn('[opportunityRadar] product_comparison count error', comparisonResult.error.message);
  }
  if (buyingIntentResult.error) {
    console.warn('[opportunityRadar] buying_intent count error', buyingIntentResult.error.message);
  }

  return {
    competitor_complaints: competitorResult.count ?? 0,
    recommendation_requests: recommendationResult.count ?? 0,
    product_comparisons: comparisonResult.count ?? 0,
    buying_intent: buyingIntentResult.count ?? 0,
    window_hours: windowHours,
  };
}

export type OpportunityRadarItem = {
  id: string;
  organization_id: string;
  opportunity_type: string;
  source: string;
  title: string;
  description: string | null;
  confidence_score: number;
  signal_count: number;
  topic_keywords: string[];
  related_campaign_id: string | null;
  detected_at: string;
  opportunity_score: number | null;
  status: string;
};

/**
 * Fetch opportunity_radar items (campaign engagement signals pipeline).
 * Supports source=campaign_engagement and campaignId filters.
 * Sorted by opportunity_score DESC.
 */
export async function getOpportunityRadarItems(
  organizationId: string,
  options?: { source?: string; campaignId?: string; opportunityType?: string; limit?: number }
): Promise<OpportunityRadarItem[]> {
  if (!organizationId) return [];

  let q = supabase
    .from('opportunity_radar')
    .select('id, organization_id, opportunity_type, source, title, description, confidence_score, signal_count, topic_keywords, related_campaign_id, detected_at, opportunity_score, status')
    .eq('organization_id', organizationId)
    .eq('status', 'new')
    .order('opportunity_score', { ascending: false })
    .limit(options?.limit ?? 50);

  if (options?.source) {
    q = q.eq('source', options.source);
  }
  if (options?.campaignId) {
    q = q.or(`related_campaign_id.eq.${options.campaignId},related_campaign_id.is.null`);
  }
  if (options?.opportunityType) {
    q = q.eq('opportunity_type', options.opportunityType);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[opportunityRadar] getOpportunityRadarItems error', error.message);
    return [];
  }

  return (data || []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    organization_id: r.organization_id as string,
    opportunity_type: r.opportunity_type as string,
    source: r.source as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    confidence_score: Number(r.confidence_score) ?? 0,
    signal_count: Number(r.signal_count) ?? 0,
    topic_keywords: (r.topic_keywords as string[]) ?? [],
    related_campaign_id: (r.related_campaign_id as string) ?? null,
    detected_at: r.detected_at as string,
    opportunity_score: r.opportunity_score != null ? Number(r.opportunity_score) : null,
    status: r.status as string,
  }));
}
