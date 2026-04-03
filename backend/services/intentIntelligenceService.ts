import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { clamp } from './intelligenceEngineUtils';

type KeywordMetric = {
  keyword_id: string;
  impressions: number;
  clicks: number;
  avg_position: number | null;
};

type SessionRow = {
  source: string;
  is_engaged: boolean;
  page_view_count: number | null;
};

function sinceDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function generateIntentIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('intentIntelligenceService');

  const [{ data: metrics, error: metricsError }, { data: sessions, error: sessionsError }] = await Promise.all([
    supabase
      .from('keyword_metrics')
      .select('keyword_id, impressions, clicks, avg_position')
      .eq('company_id', companyId)
      .gte('metric_date', sinceDays(30).slice(0, 10))
      .limit(1200),
    supabase
      .from('canonical_sessions')
      .select('source, is_engaged, page_view_count')
      .eq('company_id', companyId)
      .gte('started_at', sinceDays(30))
      .limit(1600),
  ]);

  if (metricsError) throw new Error(`Failed to load keyword metrics for intent engine: ${metricsError.message}`);
  if (sessionsError) throw new Error(`Failed to load sessions for intent engine: ${sessionsError.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'growth',
    source_service: 'intentIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const metricRows = (metrics ?? []) as KeywordMetric[];
  const sessionRows = (sessions ?? []) as SessionRow[];
  if (metricRows.length === 0 && sessionRows.length === 0) return [];

  const impressions = metricRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const clicks = metricRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const avgPosition = metricRows.length > 0
    ? metricRows.reduce((sum, row) => sum + Number(row.avg_position ?? 0), 0) / metricRows.length
    : 0;

  const totalSessions = sessionRows.length;
  const engagedSessions = sessionRows.filter((row) => row.is_engaged).length;
  const deepSessions = sessionRows.filter((row) => Number(row.page_view_count ?? 0) >= 3).length;
  const engagementRate = totalSessions > 0 ? engagedSessions / totalSessions : 0;
  const deepRate = totalSessions > 0 ? deepSessions / totalSessions : 0;

  const decisions = [];

  if (impressions >= 300 && ctr < 0.03) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'intentIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'intent_gap',
      title: 'Search demand is not matching current intent capture',
      description: 'There is measurable demand, but low click response indicates intent mismatch in current assets.',
      evidence: {
        impressions,
        clicks,
        ctr,
      },
      impact_traffic: clamp(44 + Math.round((0.03 - ctr) * 700), 0, 100),
      impact_conversion: 38,
      impact_revenue: 34,
      priority_score: 62,
      effort_score: 22,
      confidence_score: 0.81,
      recommendation: 'Re-align page messaging and SERP assets to explicit problem-intent language.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'intent_capture' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (impressions >= 500 && avgPosition >= 6 && avgPosition <= 30) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'intentIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'demand_opportunity',
      title: 'Demand opportunity exists in reachable ranking zones',
      description: 'Query demand is visible and ranking is close enough for accelerated capture.',
      evidence: {
        impressions,
        avg_position: avgPosition,
      },
      impact_traffic: 56,
      impact_conversion: 32,
      impact_revenue: 36,
      priority_score: 68,
      effort_score: 24,
      confidence_score: 0.77,
      recommendation: 'Prioritize intent-cluster pages that can move from position 10-30 into top traffic bands.',
      action_type: 'improve_content',
      action_payload: { optimization_focus: 'demand_capture' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (totalSessions >= 150 && engagementRate < 0.35 && deepRate < 0.2) {
    decisions.push({
      company_id: companyId,
      report_tier: 'growth' as const,
      source_service: 'intentIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'conversion_intent_gap',
      title: 'Intentful traffic is not progressing to conversion behavior',
      description: 'Session depth and engagement indicate users are arriving but not finding a matching conversion path.',
      evidence: {
        total_sessions: totalSessions,
        engagement_rate: engagementRate,
        deep_session_rate: deepRate,
      },
      impact_traffic: 22,
      impact_conversion: 58,
      impact_revenue: 52,
      priority_score: 66,
      effort_score: 20,
      confidence_score: 0.79,
      recommendation: 'Tighten intent-to-conversion handoff using clearer offer framing and next-step CTA paths.',
      action_type: 'fix_cta',
      action_payload: { optimization_focus: 'conversion_intent' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
