import { supabase } from '../db/supabaseClient';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { archiveDecisionSourceEntityType, createDecisionObjects, type PersistedDecisionObject } from './decisionObjectService';
import { clamp } from './intelligenceEngineUtils';

type DecisionRow = {
  id: string;
  created_at: string;
  priority_score: number;
  status: 'open' | 'resolved' | 'ignored';
};

function ageDays(timestamp: string): number {
  const ms = new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
}

export async function generateVelocityIntelligenceDecisions(companyId: string): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('velocityIntelligenceService');

  const { data, error } = await supabase
    .from('decision_objects')
    .select('id, created_at, priority_score, status')
    .eq('company_id', companyId)
    .in('status', ['open'])
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) throw new Error(`Failed to load decisions for velocity intelligence: ${error.message}`);

  await archiveDecisionSourceEntityType({
    company_id: companyId,
    report_tier: 'deep',
    source_service: 'velocityIntelligenceService',
    entity_type: 'global',
    changed_by: 'system',
  });

  const rows = (data ?? []) as DecisionRow[];
  if (rows.length === 0) return [];

  const aged = rows.filter((row) => ageDays(row.created_at) >= 5);
  const highPriorityAged = aged.filter((row) => Number(row.priority_score ?? 0) >= 70);
  const avgAge = aged.length > 0
    ? aged.reduce((sum, row) => sum + ageDays(row.created_at), 0) / aged.length
    : 0;

  const decisions = [];

  if (aged.length >= 20 || avgAge >= 7) {
    decisions.push({
      company_id: companyId,
      report_tier: 'deep' as const,
      source_service: 'velocityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'slow_response_risk',
      title: 'Decision response velocity is below target cadence',
      description: 'Aged open decisions indicate systemic lag in intelligence execution response.',
      evidence: {
        aged_open_decisions: aged.length,
        average_age_days: avgAge,
      },
      impact_traffic: 20,
      impact_conversion: 44,
      impact_revenue: 48,
      priority_score: 65,
      effort_score: 18,
      confidence_score: 0.82,
      recommendation: 'Introduce response SLA enforcement for open strategic decisions.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'velocity_sla' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (highPriorityAged.length >= 8) {
    decisions.push({
      company_id: companyId,
      report_tier: 'deep' as const,
      source_service: 'velocityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'execution_delay',
      title: 'High-priority decisions are delayed in execution',
      description: 'Critical decisions are remaining open too long, reducing expected value realization.',
      evidence: {
        high_priority_aged_count: highPriorityAged.length,
        sample_ids: highPriorityAged.slice(0, 10).map((row) => row.id),
      },
      impact_traffic: 18,
      impact_conversion: 50,
      impact_revenue: 56,
      priority_score: clamp(62 + highPriorityAged.length, 0, 100),
      effort_score: 22,
      confidence_score: 0.8,
      recommendation: 'Escalate delayed high-priority actions into an execution sprint lane.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'execution_delay' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (avgAge >= 10 && highPriorityAged.length >= 4) {
    decisions.push({
      company_id: companyId,
      report_tier: 'deep' as const,
      source_service: 'velocityIntelligenceService',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: 'missed_opportunity_due_to_lag',
      title: 'Opportunity value is decaying due to response lag',
      description: 'Extended action lag on material priorities indicates likely opportunity decay.',
      evidence: {
        average_age_days: avgAge,
        high_priority_aged_count: highPriorityAged.length,
      },
      impact_traffic: 26,
      impact_conversion: 54,
      impact_revenue: 62,
      priority_score: 72,
      effort_score: 20,
      confidence_score: 0.74,
      recommendation: 'Apply expiration-aware prioritization to prevent high-value opportunities from timing out.',
      action_type: 'adjust_strategy',
      action_payload: { optimization_focus: 'opportunity_decay' },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    });
  }

  if (decisions.length === 0) return [];
  return createDecisionObjects(decisions);
}
