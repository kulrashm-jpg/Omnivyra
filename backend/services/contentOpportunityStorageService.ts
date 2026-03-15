/**
 * Content Opportunity Storage Service
 * Persists content opportunities and manages status updates.
 */

import { supabase } from '../db/supabaseClient';

export type ContentOpportunityStatus =
  | 'new'
  | 'reviewed'
  | 'approved'
  | 'assigned'
  | 'ignored'
  | 'sent_to_campaign'
  | 'in_campaign'
  | 'content_created'
  | 'performance_tracked'
  | 'completed';

export type ContentOpportunityInput = {
  topic: string;
  opportunity_type: string;
  suggested_title: string;
  confidence_score: number;
  signal_summary: {
    questions: number;
    problems: number;
    comparisons: number;
    feature_requests: number;
  };
  source_topic?: string;
};

export type StoredContentOpportunity = ContentOpportunityInput & {
  id: string;
  organization_id: string;
  status: ContentOpportunityStatus;
  assigned_to?: string | null;
  campaign_id?: string | null;
  content_id?: string | null;
  impact_metrics?: Record<string, number> | null;
  created_at: string;
  updated_at: string | null;
};

export async function getStoredContentOpportunity(
  id: string,
  organizationId: string
): Promise<StoredContentOpportunity | null> {
  const { data, error } = await supabase
    .from('engagement_content_opportunities')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single();

  if (error || !data) return null;
  return data as StoredContentOpportunity;
}

const DUPLICATE_DAYS = 7;
const SIMILARITY_THRESHOLD = 0.85;

function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersect = 0;
  for (const w of wa) {
    if (wb.has(w)) intersect++;
  }
  return intersect / (wa.size + wb.size - intersect);
}

export async function storeContentOpportunity(
  organizationId: string,
  opportunity: ContentOpportunityInput
): Promise<StoredContentOpportunity | null> {
  const cutoff = new Date(Date.now() - DUPLICATE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await supabase
    .from('engagement_content_opportunities')
    .select('id, organization_id, topic, opportunity_type, suggested_title, confidence_score, signal_summary, source_topic, status, created_at, updated_at')
    .eq('organization_id', organizationId)
    .eq('topic', opportunity.topic)
    .gte('created_at', cutoff);

  const existing = (candidates ?? []).find(
    (c: { suggested_title: string }) =>
      c.suggested_title === opportunity.suggested_title ||
      jaccardSimilarity(c.suggested_title, opportunity.suggested_title) >= SIMILARITY_THRESHOLD
  );

  if (existing) {
    return existing as StoredContentOpportunity;
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from('engagement_content_opportunities')
    .insert({
      organization_id: organizationId,
      topic: opportunity.topic,
      opportunity_type: opportunity.opportunity_type,
      suggested_title: opportunity.suggested_title,
      confidence_score: opportunity.confidence_score,
      signal_summary: opportunity.signal_summary,
      source_topic: opportunity.source_topic ?? opportunity.topic,
      status: 'new',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    console.error('[contentOpportunityStorageService] storeContentOpportunity', error);
    return null;
  }
  return inserted as StoredContentOpportunity;
}

export async function updateContentOpportunityStatus(
  id: string,
  status: ContentOpportunityStatus,
  organizationId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityStorageService] updateContentOpportunityStatus', error);
    return false;
  }
  return true;
}
