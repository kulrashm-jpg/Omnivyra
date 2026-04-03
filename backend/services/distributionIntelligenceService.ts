import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { clamp, normalizeText } from './intelligenceEngineUtils';

type SessionRow = {
  source: string;
  source_medium: string | null;
  is_engaged: boolean;
  page_view_count: number | null;
};

type LeadRow = {
  source: string;
  qualification_score: number | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateDistributionIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('distributionIntelligenceService');

  const [{ data: sessions, error: sessionsError }, { data: leads, error: leadsError }] = await Promise.all([
    supabase
      .from('canonical_sessions')
      .select('source, source_medium, is_engaged, page_view_count')
      .eq('company_id', companyId)
      .gte('started_at', sinceDays(30))
      .limit(2200),
    supabase
      .from('canonical_leads')
      .select('source, qualification_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceDays(60))
      .limit(800),
  ]);

  if (sessionsError) throw new Error(`Failed to load sessions for distribution engine: ${sessionsError.message}`);
  if (leadsError) throw new Error(`Failed to load leads for distribution engine: ${leadsError.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'distributionIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const sessionRows = (sessions ?? []) as SessionRow[];
  if (sessionRows.length === 0) return [];

  const byChannel = new Map<string, { sessions: number; engaged: number; deep: number }>();
  for (const row of sessionRows) {
    const channel = normalizeText(row.source_medium || row.source || 'unknown') || 'unknown';
    const current = byChannel.get(channel) ?? { sessions: 0, engaged: 0, deep: 0 };
    current.sessions += 1;
    if (row.is_engaged) current.engaged += 1;
    if (Number(row.page_view_count ?? 0) >= 3) current.deep += 1;
    byChannel.set(channel, current);
  }

  const leadRows = (leads ?? []) as LeadRow[];
  const byLeadSource = new Map<string, { count: number; qualityTotal: number }>();
  for (const lead of leadRows) {
    const source = normalizeText(lead.source) || 'unknown';
    const current = byLeadSource.get(source) ?? { count: 0, qualityTotal: 0 };
    current.count += 1;
    current.qualityTotal += Number(lead.qualification_score ?? 0);
    byLeadSource.set(source, current);
  }

  const topChannel = [...byChannel.entries()].sort((a, b) => b[1].sessions - a[1].sessions)[0];
  if (!topChannel) return [];

  const totalSessions = sessionRows.length;
  const topShare = topChannel[1].sessions / totalSessions;
  const topEngagement = topChannel[1].engaged / Math.max(1, topChannel[1].sessions);
  const topDepth = topChannel[1].deep / Math.max(1, topChannel[1].sessions);

  const decisions = [];

  if (topShare >= 0.45 && topEngagement < 0.32) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'distributionIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'channel_mismatch',
      title: 'Primary distribution channel is over-concentrated and under-engaged',
      description: 'A dominant channel carries too much volume with weak engagement depth.',
      evidence: {
        channel: topChannel[0],
        traffic_share: topShare,
        engagement_rate: topEngagement,
      },
      impact_traffic: 30,
      impact_conversion: 52,
      impact_revenue: 46,
      priority_score: 64,
      effort_score: 20,
      confidence_score: 0.82,
      recommendation: 'Rebalance distribution into higher-intent channels and tune message-channel fit.',
      action_type: 'fix_distribution',
      action_payload: { optimization_focus: 'channel_rebalance', channel: topChannel[0] },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (topDepth < 0.2) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'distributionIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'distribution_inefficiency',
      title: 'Distribution is generating shallow traffic depth',
      description: 'Most distributed sessions are not progressing into deeper browsing behavior.',
      evidence: {
        top_channel: topChannel[0],
        deep_session_rate: topDepth,
      },
      impact_traffic: 26,
      impact_conversion: 54,
      impact_revenue: 50,
      priority_score: 62,
      effort_score: 18,
      confidence_score: 0.78,
      recommendation: 'Improve destination relevance and sequencing so distributed traffic advances deeper in-session.',
      action_type: 'fix_distribution',
      action_payload: { optimization_focus: 'depth_recovery' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  const weakLeadSource = [...byLeadSource.entries()].find((entry) => entry[1].count >= 5 && (entry[1].qualityTotal / entry[1].count) < 45);
  if (weakLeadSource) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'distributionIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'platform_fit_gap',
      title: 'Platform/source fit is weak for qualified lead generation',
      description: 'Lead source quality suggests the current platform mix is attracting lower-fit traffic.',
      evidence: {
        source: weakLeadSource[0],
        lead_count: weakLeadSource[1].count,
        average_quality: weakLeadSource[1].qualityTotal / weakLeadSource[1].count,
      },
      impact_traffic: 20,
      impact_conversion: 58,
      impact_revenue: 56,
      priority_score: 68,
      effort_score: 24,
      confidence_score: 0.8,
      recommendation: 'Shift channel investment toward sources with higher qualified lead yield.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'platform_fit' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
