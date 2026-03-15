/**
 * Opportunity Health Service
 * Executive metrics for content opportunity pipeline health.
 * Data source: engagement_content_opportunities
 */

import { supabase } from '../db/supabaseClient';

export type OpportunityHealthMetrics = {
  opportunities_detected_last_7d: number;
  opportunities_approved_last_7d: number;
  opportunities_ignored_last_7d: number;
  opportunities_sent_to_campaign: number;
  opportunities_completed: number;
  average_confidence_score: number;
  approval_rate: number;
  campaign_conversion_rate: number;
};

export async function getOpportunityHealth(
  organizationId: string
): Promise<OpportunityHealthMetrics> {
  if (!organizationId) {
    return {
      opportunities_detected_last_7d: 0,
      opportunities_approved_last_7d: 0,
      opportunities_ignored_last_7d: 0,
      opportunities_sent_to_campaign: 0,
      opportunities_completed: 0,
      average_confidence_score: 0,
      approval_rate: 0,
      campaign_conversion_rate: 0,
    };
  }

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('engagement_content_opportunities')
    .select('status, confidence_score')
    .eq('organization_id', organizationId)
    .gte('created_at', since7d);

  if (error) {
    console.warn('[opportunityHealthService] getOpportunityHealth error', error.message);
    return {
      opportunities_detected_last_7d: 0,
      opportunities_approved_last_7d: 0,
      opportunities_ignored_last_7d: 0,
      opportunities_sent_to_campaign: 0,
      opportunities_completed: 0,
      average_confidence_score: 0,
      approval_rate: 0,
      campaign_conversion_rate: 0,
    };
  }

  const list = rows ?? [];
  const detected = list.length;
  const approved = list.filter((r: { status?: string }) => r.status === 'approved').length;
  const ignored = list.filter((r: { status?: string }) => r.status === 'ignored').length;
  const sentToCampaign = list.filter((r: { status?: string }) =>
    ['sent_to_campaign', 'in_campaign', 'content_created', 'performance_tracked', 'completed'].includes(
      r.status ?? ''
    )
  ).length;
  const completed = list.filter((r: { status?: string }) => r.status === 'completed').length;

  const confScores = list
    .map((r: { confidence_score?: number | null }) => r.confidence_score)
    .filter((c): c is number => typeof c === 'number' && !Number.isNaN(c));
  const avgConfidence =
    confScores.length > 0
      ? confScores.reduce((a, b) => a + b, 0) / confScores.length
      : 0;

  const actedOn = approved + ignored;
  const approval_rate = actedOn > 0 ? approved / actedOn : 0;
  const campaign_conversion_rate = detected > 0 ? sentToCampaign / detected : 0;

  return {
    opportunities_detected_last_7d: detected,
    opportunities_approved_last_7d: approved,
    opportunities_ignored_last_7d: ignored,
    opportunities_sent_to_campaign: sentToCampaign,
    opportunities_completed: completed,
    average_confidence_score: Math.round(avgConfidence * 1000) / 1000,
    approval_rate: Math.round(approval_rate * 1000) / 1000,
    campaign_conversion_rate: Math.round(campaign_conversion_rate * 1000) / 1000,
  };
}

export type OpportunityInsights = {
  top_performing_opportunity_type: string;
  highest_approval_opportunity_type: string;
  topics_generating_campaigns: string[];
};

export async function getOpportunityInsights(
  organizationId: string
): Promise<OpportunityInsights> {
  if (!organizationId) {
    return {
      top_performing_opportunity_type: '',
      highest_approval_opportunity_type: '',
      topics_generating_campaigns: [],
    };
  }

  const campaignStatuses = [
    'sent_to_campaign',
    'in_campaign',
    'content_created',
    'performance_tracked',
    'completed',
  ];

  const { data: oppRows } = await supabase
    .from('engagement_content_opportunities')
    .select('opportunity_type, topic')
    .eq('organization_id', organizationId)
    .in('status', campaignStatuses);

  const { data: lmRows } = await supabase
    .from('opportunity_learning_metrics')
    .select('opportunity_type, approvals, ignores, campaigns_created, completions')
    .eq('organization_id', organizationId);

  const campaignsByType = new Map<string, number>();
  const approvalByType = new Map<string, { approvals: number; total: number }>();
  const topicsSet = new Set<string>();

  for (const r of oppRows ?? []) {
    const t = (r.opportunity_type ?? 'thought_leadership').toString();
    campaignsByType.set(t, (campaignsByType.get(t) ?? 0) + 1);
    if (r.topic) topicsSet.add(String(r.topic));
  }

  for (const r of lmRows ?? []) {
    const t = (r.opportunity_type ?? 'thought_leadership').toString();
    const total = r.approvals + r.ignores + r.campaigns_created;
    if (total > 0) {
      approvalByType.set(t, { approvals: r.approvals, total });
    }
  }

  const sortedByPerf = [...campaignsByType.entries()].sort((a, b) => b[1] - a[1]);
  const topPerforming = sortedByPerf[0]?.[0] ?? '';

  const sortedByApproval = [...approvalByType.entries()].sort((a, b) => {
    const ar = a[1].approvals / a[1].total;
    const br = b[1].approvals / b[1].total;
    return br - ar;
  });
  const highestApproval = sortedByApproval[0]?.[0] ?? '';

  return {
    top_performing_opportunity_type: topPerforming || '—',
    highest_approval_opportunity_type: highestApproval || '—',
    topics_generating_campaigns: Array.from(topicsSet).slice(0, 10),
  };
}
