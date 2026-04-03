import type { DecisionNarrativeCluster } from './DecisionCompressionService';
import type { DecisionNarrative } from './NarrativeService';
import {
  getActionCategory,
  getActionInstructionCode,
  type ActionCategory,
} from './actionRegistryService';

export type ActionPlaybookStep = {
  step: number;
  instruction: string;
  owner: 'cmo' | 'marketing_ops' | 'content_lead' | 'analytics';
};

export type NarrativeActionPlaybook = {
  cluster_id: string;
  playbook_id: string;
  instruction_code: string;
  target_block_id?: string;
  impact: number;
  expected_score_gain: number;
  action_category: ActionCategory;
  confidence: number;
  confidence_per_action: number;
  priority_score: number;
  dependencies?: string[];
  action_type: string;
  payload: Record<string, unknown>;
  owner: ActionPlaybookStep['owner'];
  timeline: {
    start_at: string;
    due_at: string;
    days: number;
  };
  objective: string;
  timeline_days: number;
  expected_kpi_lift: string;
  steps: ActionPlaybookStep[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, precision = 3): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function deriveTargetBlockId(payload: Record<string, unknown>, cluster: DecisionNarrativeCluster): string | undefined {
  const direct = [
    payload.target_block_id,
    payload.block_id,
    payload.page_id,
    payload.target_id,
    payload.campaign_id,
    cluster.decisions[0]?.entity_id,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  return typeof direct === 'string' ? direct : undefined;
}

function deriveActionConfidence(cluster: DecisionNarrativeCluster, payload: Record<string, unknown>): number {
  const signalStrength = avg(cluster.decisions.map((decision) => Number(decision.confidence_score ?? 0)));
  const evidenceCompleteness = clamp(cluster.evidence.key_signals.length / 6, 0, 1);
  const payloadCompleteness = clamp(Object.keys(payload).length / 6, 0, 1);
  return round(clamp((signalStrength * 0.6) + (evidenceCompleteness * 0.25) + (payloadCompleteness * 0.15), 0, 1), 3);
}

function deriveExpectedScoreGain(cluster: DecisionNarrativeCluster, confidence: number): number {
  const gain = (cluster.business_impact_score * 0.14) + (cluster.priority_score * 0.08) + (confidence * 10);
  return Math.round(clamp(gain, 1, 30));
}

function deriveActionPriority(params: {
  impact: number;
  expectedScoreGain: number;
  confidence: number;
}): number {
  const expectedScoreGainWeighted = params.expectedScoreGain * 2.2;
  const confidenceContribution = params.confidence * 100 * 0.18;

  return Math.round(
    clamp(
      (params.impact * 0.55) + expectedScoreGainWeighted + confidenceContribution,
      0,
      100,
    )
  );
}

function deriveDependencies(params: {
  instructionCode: string;
  targetBlockId?: string;
  confidence: number;
  payload: Record<string, unknown>;
}): string[] {
  const dependencies = new Set<string>();

  if (params.instructionCode === 'CTA_FIX') {
    dependencies.add('CONTENT_IMPROVEMENT');
  }

  if (params.instructionCode === 'LEAD_CAPTURE') {
    dependencies.add('CTA_FIX');
  }

  if (params.instructionCode === 'DISTRIBUTION_REPAIR') {
    dependencies.add('CONTENT_IMPROVEMENT');
  }

  if (params.instructionCode === 'BUDGET_REALLOCATION' || params.instructionCode === 'CAMPAIGN_LAUNCH') {
    dependencies.add('TRACKING_IMPROVEMENT');
  }

  if (params.instructionCode === 'STRATEGY_ADJUSTMENT' || params.instructionCode === 'LEARNING_APPLICATION') {
    dependencies.add('TRACKING_IMPROVEMENT');
  }

  if (!params.targetBlockId && (params.instructionCode === 'CONTENT_IMPROVEMENT' || params.instructionCode === 'CTA_FIX')) {
    dependencies.add('CONTENT_IMPROVEMENT');
  }

  if (typeof params.payload.campaign_id !== 'string' && (params.instructionCode === 'BUDGET_REALLOCATION' || params.instructionCode === 'STRATEGY_ADJUSTMENT')) {
    dependencies.add('TRACKING_IMPROVEMENT');
  }

  if (params.confidence < 0.55) {
    dependencies.add('LEARNING_APPLICATION');
  }

  return [...dependencies];
}

function ownerForCategory(category: DecisionNarrativeCluster['category']): ActionPlaybookStep['owner'] {
  if (category === 'performance' || category === 'distribution') return 'marketing_ops';
  if (category === 'content_strategy' || category === 'authority') return 'content_lead';
  if (category === 'governance' || category === 'risk' || category === 'velocity') return 'analytics';
  return 'cmo';
}

function stepsFromRecommendations(cluster: DecisionNarrativeCluster): string[] {
  if (cluster.recommendations.length > 0) return cluster.recommendations.slice(0, 3);
  return [
    'Prioritize highest-impact decision in this cluster.',
    'Assign accountable owner and execution deadline.',
    'Track leading indicator movement within 7 days.',
  ];
}

export function buildActionPlaybooks(params: {
  clusters: DecisionNarrativeCluster[];
  narratives: DecisionNarrative[];
}): NarrativeActionPlaybook[] {
  const narrativeByCluster = new Map((params.narratives ?? []).map((narrative) => [narrative.cluster_id, narrative]));

  return (params.clusters ?? []).map((cluster, index) => {
    const objective = narrativeByCluster.get(cluster.cluster_id)?.what_to_do ?? cluster.recommendations[0] ?? cluster.title;
    const owner = ownerForCategory(cluster.category);
    const timelineDays = Math.max(7, Math.min(30, 8 + Math.round(cluster.priority_score / 5)));
    const expectedLift = `${Math.max(5, Math.round(cluster.business_impact_score * 0.25))}%`;
    const anchorDecision = cluster.decisions[0];
    const actionType = anchorDecision?.action_type ?? 'adjust_strategy';
    const payload = {
      ...(anchorDecision?.action_payload ?? {}),
      cluster_id: cluster.cluster_id,
      dominant_issue_type: cluster.dominant_issue_type,
    };
    const instructionCode = getActionInstructionCode(actionType);
    const actionCategory = getActionCategory(actionType);
    const targetBlockId = deriveTargetBlockId(payload, cluster);
    const confidence = deriveActionConfidence(cluster, payload);
    const expectedScoreGain = deriveExpectedScoreGain(cluster, confidence);
    const impact = Math.round(cluster.business_impact_score);
    const dependencies = deriveDependencies({
      instructionCode,
      targetBlockId,
      confidence,
      payload,
    });
    const priorityScore = deriveActionPriority({
      impact,
      expectedScoreGain,
      confidence,
    });
    const now = new Date();
    const due = new Date(now.getTime() + timelineDays * 24 * 60 * 60 * 1000);

    return {
      cluster_id: cluster.cluster_id,
      playbook_id: `playbook_${index + 1}`,
      instruction_code: instructionCode,
      target_block_id: targetBlockId,
      impact,
      expected_score_gain: expectedScoreGain,
      action_category: actionCategory,
      confidence,
      confidence_per_action: confidence,
      priority_score: priorityScore,
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      action_type: actionType,
      payload,
      owner,
      timeline: {
        start_at: now.toISOString(),
        due_at: due.toISOString(),
        days: timelineDays,
      },
      objective,
      timeline_days: timelineDays,
      expected_kpi_lift: expectedLift,
      steps: stepsFromRecommendations(cluster).map((instruction, stepIndex) => ({
        step: stepIndex + 1,
        instruction,
        owner,
      })),
    };
  });
}
