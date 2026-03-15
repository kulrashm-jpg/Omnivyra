/**
 * Opportunity Learning Service
 * Learn from user actions: approved, ignored, sent_to_campaign, completed.
 * Extended metrics: average_confidence_score, average_time_to_campaign, average_time_to_completion.
 */

import { supabase } from '../db/supabaseClient';

export type LearningMetrics = {
  organization_id: string;
  opportunity_type: string;
  approvals: number;
  ignores: number;
  campaigns_created: number;
  completions: number;
  last_updated: string;
  average_confidence_score?: number;
  average_time_to_campaign?: number;
  average_time_to_completion?: number;
};

export async function aggregateOpportunityLearning(
  organizationId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from('engagement_content_opportunities')
    .select('opportunity_type, status, confidence_score, created_at, updated_at')
    .eq('organization_id', organizationId);

  const byType = new Map<
    string,
    {
      approvals: number;
      ignores: number;
      campaigns_created: number;
      completions: number;
      confScores: number[];
      timesToCampaign: number[];
      timesToCompletion: number[];
    }
  >();

  for (const r of rows ?? []) {
    const t = (r.opportunity_type ?? 'thought_leadership').toString();
    if (!byType.has(t)) {
      byType.set(t, {
        approvals: 0,
        ignores: 0,
        campaigns_created: 0,
        completions: 0,
        confScores: [],
        timesToCampaign: [],
        timesToCompletion: [],
      });
    }
    const m = byType.get(t)!;
    const status = (r.status ?? '').toString();
    if (status === 'approved') m.approvals += 1;
    else if (status === 'ignored') m.ignores += 1;
    else if (status === 'sent_to_campaign' || status === 'in_campaign') m.campaigns_created += 1;
    else if (status === 'completed') m.completions += 1;

    const conf = r.confidence_score;
    if (typeof conf === 'number' && !Number.isNaN(conf)) {
      m.confScores.push(conf);
    }

    const createdAt = r.created_at ? new Date(r.created_at).getTime() : 0;
    const updatedAt = r.updated_at ? new Date(r.updated_at).getTime() : createdAt;
    if (createdAt > 0 && updatedAt > 0) {
      const hoursDiff = (updatedAt - createdAt) / (1000 * 60 * 60);
      if (
        ['sent_to_campaign', 'in_campaign', 'content_created', 'performance_tracked', 'completed'].includes(
          status
        )
      ) {
        m.timesToCampaign.push(hoursDiff);
      }
      if (status === 'completed') {
        m.timesToCompletion.push(hoursDiff);
      }
    }
  }

  const now = new Date().toISOString();
  for (const [opportunity_type, metrics] of byType.entries()) {
    const avgConf =
      metrics.confScores.length > 0
        ? metrics.confScores.reduce((a, b) => a + b, 0) / metrics.confScores.length
        : null;
    const avgTimeToCampaign =
      metrics.timesToCampaign.length > 0
        ? metrics.timesToCampaign.reduce((a, b) => a + b, 0) / metrics.timesToCampaign.length
        : null;
    const avgTimeToCompletion =
      metrics.timesToCompletion.length > 0
        ? metrics.timesToCompletion.reduce((a, b) => a + b, 0) / metrics.timesToCompletion.length
        : null;

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      opportunity_type,
      approvals: metrics.approvals,
      ignores: metrics.ignores,
      campaigns_created: metrics.campaigns_created,
      completions: metrics.completions,
      last_updated: now,
    };
    if (avgConf != null) payload.average_confidence_score = Math.round(avgConf * 1000) / 1000;
    if (avgTimeToCampaign != null)
      payload.average_time_to_campaign_hours = Math.round(avgTimeToCampaign * 100) / 100;
    if (avgTimeToCompletion != null)
      payload.average_time_to_completion_hours = Math.round(avgTimeToCompletion * 100) / 100;

    await supabase
      .from('opportunity_learning_metrics')
      .upsert(payload as Record<string, unknown>, {
        onConflict: 'organization_id,opportunity_type',
        ignoreDuplicates: false,
      });
  }
}

export async function getLearningMetrics(
  organizationId: string
): Promise<
  Map<
    string,
    {
      approval_rate: number;
      ignore_rate: number;
      campaign_conversion_rate: number;
      average_confidence_score?: number;
      average_time_to_campaign?: number;
      average_time_to_completion?: number;
    }
  >
> {
  const { data } = await supabase
    .from('opportunity_learning_metrics')
    .select(
      'opportunity_type, approvals, ignores, campaigns_created, completions, average_confidence_score, average_time_to_campaign_hours, average_time_to_completion_hours'
    )
    .eq('organization_id', organizationId);

  const result = new Map<
    string,
    {
      approval_rate: number;
      ignore_rate: number;
      campaign_conversion_rate: number;
      average_confidence_score?: number;
      average_time_to_campaign?: number;
      average_time_to_completion?: number;
    }
  >();

  for (const r of data ?? []) {
    const total = r.approvals + r.ignores + r.campaigns_created;
    if (total === 0) {
      result.set(r.opportunity_type, {
        approval_rate: 1,
        ignore_rate: 0,
        campaign_conversion_rate: 0,
        average_confidence_score: r.average_confidence_score,
        average_time_to_campaign: r.average_time_to_campaign_hours,
        average_time_to_completion: r.average_time_to_completion_hours,
      });
      continue;
    }
    result.set(r.opportunity_type, {
      approval_rate: r.approvals / total,
      ignore_rate: r.ignores / total,
      campaign_conversion_rate: r.campaigns_created / total,
      average_confidence_score: r.average_confidence_score,
      average_time_to_campaign: r.average_time_to_campaign_hours,
      average_time_to_completion: r.average_time_to_completion_hours,
    });
  }
  return result;
}
