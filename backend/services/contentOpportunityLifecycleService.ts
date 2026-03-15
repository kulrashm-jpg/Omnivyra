/**
 * Content Opportunity Lifecycle Service
 * Supports full lifecycle from discovery to campaign execution and impact analysis.
 */

import { supabase } from '../db/supabaseClient';

export type LifecycleStatus =
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

export type ImpactMetrics = {
  views?: number;
  engagement_rate?: number;
  leads_generated?: number;
  conversion_rate?: number;
  [key: string]: number | undefined;
};

export async function assignOpportunity(
  id: string,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({
      assigned_to: userId,
      status: 'assigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityLifecycleService] assignOpportunity', error);
    return false;
  }
  return true;
}

export async function linkOpportunityToCampaign(
  id: string,
  campaignId: string,
  organizationId: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('engagement_content_opportunities')
    .select('campaign_id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single();

  if (existing?.campaign_id != null) {
    return false;
  }

  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({
      campaign_id: campaignId,
      status: 'in_campaign',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityLifecycleService] linkOpportunityToCampaign', error);
    return false;
  }
  return true;
}

export async function linkOpportunityToContent(
  id: string,
  contentId: string,
  organizationId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({
      content_id: contentId,
      status: 'content_created',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityLifecycleService] linkOpportunityToContent', error);
    return false;
  }
  return true;
}

export async function recordOpportunityImpact(
  id: string,
  metrics: ImpactMetrics,
  organizationId: string
): Promise<boolean> {
  const { data: row } = await supabase
    .from('engagement_content_opportunities')
    .select('impact_metrics')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single();

  const existing = (row?.impact_metrics as Record<string, number> | null) ?? {};
  const merged = { ...existing, ...metrics };

  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({
      impact_metrics: merged,
      status: 'performance_tracked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityLifecycleService] recordOpportunityImpact', error);
    return false;
  }
  return true;
}

export async function completeOpportunity(id: string, organizationId: string): Promise<boolean> {
  const { error } = await supabase
    .from('engagement_content_opportunities')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId);

  if (error) {
    console.error('[contentOpportunityLifecycleService] completeOpportunity', error);
    return false;
  }
  return true;
}
