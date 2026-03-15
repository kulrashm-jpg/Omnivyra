/**
 * Engagement Analytics Service
 * Dashboard analytics: categories, sentiment, strategy performance, trends.
 */

import { supabase } from '../db/supabaseClient';

export type CategoryDistribution = { classification_category: string; count: number };
export type SentimentDistribution = { sentiment: string; count: number };
export type StrategyPerformance = {
  strategy_type: string;
  engagement_score: number;
  confidence_score: number;
  total_uses: number;
};
export type TrendPoint = { date: string; count: number };
export type ReplyPerformancePoint = {
  date: string;
  replies: number;
  likes: number;
  followups: number;
  leads: number;
};

export async function getConversationCategoryDistribution(
  organizationId: string
): Promise<CategoryDistribution[]> {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('engagement_thread_classification')
    .select('classification_category')
    .eq('organization_id', organizationId);

  if (error) {
    console.warn('[engagementAnalytics] getConversationCategoryDistribution error', error.message);
    return [];
  }

  const byCat = new Map<string, number>();
  (data ?? []).forEach((r: { classification_category?: string }) => {
    const c = (r.classification_category ?? 'unknown').toString();
    byCat.set(c, (byCat.get(c) ?? 0) + 1);
  });
  return Array.from(byCat.entries()).map(([classification_category, count]) => ({
    classification_category,
    count,
  }));
}

export async function getSentimentDistribution(
  organizationId: string
): Promise<SentimentDistribution[]> {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('engagement_thread_classification')
    .select('sentiment')
    .eq('organization_id', organizationId);

  if (error) {
    console.warn('[engagementAnalytics] getSentimentDistribution error', error.message);
    return [];
  }

  const bySent = new Map<string, number>();
  (data ?? []).forEach((r: { sentiment?: string }) => {
    const s = (r.sentiment ?? 'neutral').toString().toLowerCase();
    bySent.set(s, (bySent.get(s) ?? 0) + 1);
  });
  return Array.from(bySent.entries()).map(([sentiment, count]) => ({ sentiment, count }));
}

export async function getResponseStrategyPerformance(
  organizationId: string
): Promise<StrategyPerformance[]> {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from('response_strategy_intelligence')
    .select('strategy_type, engagement_score, confidence_score, total_uses')
    .eq('organization_id', organizationId)
    .order('engagement_score', { ascending: false });

  if (error) {
    console.warn('[engagementAnalytics] getResponseStrategyPerformance error', error.message);
    return [];
  }

  return (data ?? []) as StrategyPerformance[];
}

export async function getLeadTrend(
  organizationId: string,
  days: number = 30
): Promise<TrendPoint[]> {
  if (!organizationId) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('engagement_lead_signals')
    .select('detected_at')
    .eq('organization_id', organizationId)
    .gte('detected_at', since);

  if (error) {
    console.warn('[engagementAnalytics] getLeadTrend error', error.message);
    return [];
  }

  const byDate = new Map<string, number>();
  (data ?? []).forEach((r: { detected_at?: string }) => {
    const d = r.detected_at ? r.detected_at.slice(0, 10) : '';
    if (d) byDate.set(d, (byDate.get(d) ?? 0) + 1);
  });
  return Array.from(byDate.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getOpportunityTrend(
  organizationId: string,
  days: number = 30
): Promise<TrendPoint[]> {
  if (!organizationId) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('engagement_opportunities')
    .select('detected_at')
    .eq('organization_id', organizationId)
    .gte('detected_at', since);

  if (error) {
    console.warn('[engagementAnalytics] getOpportunityTrend error', error.message);
    return [];
  }

  const byDate = new Map<string, number>();
  (data ?? []).forEach((r: { detected_at?: string }) => {
    const d = r.detected_at ? r.detected_at.slice(0, 10) : '';
    if (d) byDate.set(d, (byDate.get(d) ?? 0) + 1);
  });
  return Array.from(byDate.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type OpportunityAnalytics = {
  opportunities_detected_last_30d: number;
  opportunities_approved_last_30d: number;
  opportunities_converted_to_campaign: number;
  opportunity_success_rate: number;
};

export async function getOpportunityAnalytics(
  organizationId: string,
  days: number = 30
): Promise<OpportunityAnalytics> {
  if (!organizationId) {
    return {
      opportunities_detected_last_30d: 0,
      opportunities_approved_last_30d: 0,
      opportunities_converted_to_campaign: 0,
      opportunity_success_rate: 0,
    };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('engagement_content_opportunities')
    .select('status')
    .eq('organization_id', organizationId)
    .gte('created_at', since);

  if (error) {
    console.warn('[engagementAnalytics] getOpportunityAnalytics error', error.message);
    return {
      opportunities_detected_last_30d: 0,
      opportunities_approved_last_30d: 0,
      opportunities_converted_to_campaign: 0,
      opportunity_success_rate: 0,
    };
  }

  const list = rows ?? [];
  const detected = list.length;
  const approved = list.filter((r: { status?: string }) => r.status === 'approved').length;
  const converted = list.filter((r: { status?: string }) =>
    ['sent_to_campaign', 'in_campaign', 'content_created', 'performance_tracked', 'completed'].includes(r.status ?? '')
  ).length;
  const success_rate = detected > 0 ? converted / detected : 0;

  return {
    opportunities_detected_last_30d: detected,
    opportunities_approved_last_30d: approved,
    opportunities_converted_to_campaign: converted,
    opportunity_success_rate: Math.round(success_rate * 1000) / 1000,
  };
}

export type OpportunityImpactAnalytics = {
  opportunities_detected_last_90d: number;
  campaigns_created_from_opportunities: number;
  content_published_from_opportunities: number;
  total_leads_generated_from_opportunities: number;
};

export async function getOpportunityImpactAnalytics(
  organizationId: string,
  days: number = 90
): Promise<OpportunityImpactAnalytics> {
  if (!organizationId) {
    return {
      opportunities_detected_last_90d: 0,
      campaigns_created_from_opportunities: 0,
      content_published_from_opportunities: 0,
      total_leads_generated_from_opportunities: 0,
    };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: oppRows, error: oppError } = await supabase
    .from('engagement_content_opportunities')
    .select('id, status, impact_metrics')
    .eq('organization_id', organizationId)
    .gte('created_at', since);

  if (oppError) {
    console.warn('[engagementAnalytics] getOpportunityImpactAnalytics error', oppError.message);
    return {
      opportunities_detected_last_90d: 0,
      campaigns_created_from_opportunities: 0,
      content_published_from_opportunities: 0,
      total_leads_generated_from_opportunities: 0,
    };
  }

  const list = oppRows ?? [];
  const detected = list.length;
  const campaignsCreated = list.filter((r: { status?: string }) =>
    ['sent_to_campaign', 'in_campaign', 'content_created', 'performance_tracked', 'completed'].includes(
      r.status ?? ''
    )
  ).length;
  const contentPublished = list.filter((r: { status?: string }) =>
    ['content_created', 'performance_tracked', 'completed'].includes(r.status ?? '')
  ).length;

  let leadsFromOpportunities = 0;
  for (const r of list) {
    const im = r.impact_metrics as Record<string, unknown> | null;
    if (im && typeof im === 'object') {
      const leads = (im.leads as number) ?? (im.lead_conversion as number) ?? (im.total_leads as number);
      if (typeof leads === 'number') leadsFromOpportunities += leads;
    }
  }

  return {
    opportunities_detected_last_90d: detected,
    campaigns_created_from_opportunities: campaignsCreated,
    content_published_from_opportunities: contentPublished,
    total_leads_generated_from_opportunities: leadsFromOpportunities,
  };
}

export async function getReplyPerformanceTrend(
  organizationId: string,
  days: number = 30
): Promise<ReplyPerformancePoint[]> {
  if (!organizationId) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('response_performance_metrics')
    .select('created_at, engagement_like_count, engagement_reply_count, engagement_followup_count, lead_conversion')
    .eq('organization_id', organizationId)
    .gte('created_at', since);

  if (error) {
    console.warn('[engagementAnalytics] getReplyPerformanceTrend error', error.message);
    return [];
  }

  const byDate = new Map<
    string,
    { replies: number; likes: number; followups: number; leads: number }
  >();
  (data ?? []).forEach((r: any) => {
    const d = r.created_at ? r.created_at.slice(0, 10) : '';
    if (!d) return;
    const cur = byDate.get(d) ?? { replies: 0, likes: 0, followups: 0, leads: 0 };
    cur.replies += 1;
    cur.likes += r.engagement_like_count ?? 0;
    cur.followups += (r.engagement_reply_count ?? 0) + (r.engagement_followup_count ?? 0);
    cur.leads += r.lead_conversion ? 1 : 0;
    byDate.set(d, cur);
  });
  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
