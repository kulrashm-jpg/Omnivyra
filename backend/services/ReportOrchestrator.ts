import {
  composeDecisionIntelligence,
  composeDecisionIntelligenceFromConfig,
  type ComposedDecisionIntelligence,
} from './decisionComposerService';
import type { PersistedDecisionObject } from './decisionObjectService';
import { listCompanyIntelligenceUnits } from './intelligenceUnitService';
import { compressDecisionObjects, type DecisionNarrativeCluster } from './DecisionCompressionService';
import { generateNarratives, type DecisionNarrative } from './NarrativeService';
import { attachNarrativeTrust, type NarrativeTrustEnvelope } from './TrustService';
import { buildActionPlaybooks, type NarrativeActionPlaybook } from './ActionService';
import { ensureSnapshotDecisionFloor } from './snapshotReportService';
import { buildPublicDomainAuditDecisions } from './publicDomainAuditService';

export type OrchestratedNarrativeBundle = {
  cluster_id: string;
  narrative: DecisionNarrative;
  trust: NarrativeTrustEnvelope;
  action: NarrativeActionPlaybook;
};

export type OrchestratedReport = {
  company_id: string;
  report_type: 'snapshot' | 'performance' | 'growth' | 'strategic';
  generated_at: string;
  diagnosis: ComposedDecisionIntelligence['diagnosis'];
  narratives: OrchestratedNarrativeBundle[];
};

export type TopPriorityItem = {
  report_type: OrchestratedReport['report_type'];
  cluster_id: string;
  title: string;
  priority_score: number;
  business_impact_score: number;
  instruction_code: string;
  action_type: string;
  action_category: string;
  expected_score_gain: number;
  confidence: number;
  owner: string;
  timeline_days: number;
};

function uniqueById(decisions: PersistedDecisionObject[]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const decision of decisions) byId.set(decision.id, decision);
  return [...byId.values()];
}

async function loadComposition(companyId: string, reportType: OrchestratedReport['report_type']): Promise<ComposedDecisionIntelligence> {
  if (reportType === 'snapshot') {
    const [units, composition, publicAudit] = await Promise.all([
      listCompanyIntelligenceUnits(companyId),
      composeDecisionIntelligence({ companyId, reportTier: 'snapshot', status: ['open'] }),
      buildPublicDomainAuditDecisions({ companyId, reportTier: 'snapshot' }),
    ]);
    return composeDecisionIntelligenceFromConfig({
      companyId,
      reportTier: 'snapshot',
      units,
      decisions: uniqueById([...composition.decisions, ...publicAudit.decisions]),
    });
  }

  if (reportType === 'performance') {
    const [units, composition, publicAudit] = await Promise.all([
      listCompanyIntelligenceUnits(companyId),
      composeDecisionIntelligence({ companyId, reportTier: 'deep', status: ['open'] }),
      buildPublicDomainAuditDecisions({ companyId, reportTier: 'deep' }),
    ]);
    return composeDecisionIntelligenceFromConfig({
      companyId,
      reportTier: 'deep',
      units,
      decisions: uniqueById([...composition.decisions, ...publicAudit.decisions]),
    });
  }

  if (reportType === 'growth') {
    return composeDecisionIntelligence({ companyId, reportTier: 'growth', status: ['open'] });
  }

  const [units, growthComposition, deepComposition] = await Promise.all([
    listCompanyIntelligenceUnits(companyId),
    composeDecisionIntelligence({ companyId, reportTier: 'growth', status: ['open'] }),
    composeDecisionIntelligence({ companyId, reportTier: 'deep', status: ['open'] }),
  ]);

  return composeDecisionIntelligenceFromConfig({
    companyId,
    reportTier: 'deep',
    units,
    decisions: uniqueById([...growthComposition.decisions, ...deepComposition.decisions]),
  });
}

function stitchBundles(params: {
  clusters: DecisionNarrativeCluster[];
  narratives: DecisionNarrative[];
  trust: NarrativeTrustEnvelope[];
  actions: NarrativeActionPlaybook[];
}): OrchestratedNarrativeBundle[] {
  const narrativeByCluster = new Map(params.narratives.map((item) => [item.cluster_id, item]));
  const trustByCluster = new Map(params.trust.map((item) => [item.cluster_id, item]));
  const actionByCluster = new Map(params.actions.map((item) => [item.cluster_id, item]));

  return params.clusters
    .map((cluster) => {
      const narrative = narrativeByCluster.get(cluster.cluster_id);
      const trust = trustByCluster.get(cluster.cluster_id);
      const action = actionByCluster.get(cluster.cluster_id);
      if (!narrative || !trust || !action) return null;
      return {
        cluster_id: cluster.cluster_id,
        narrative,
        trust,
        action,
      };
    })
    .filter((item): item is OrchestratedNarrativeBundle => Boolean(item));
}

export async function buildOrchestratedReport(params: {
  companyId: string;
  reportType: OrchestratedReport['report_type'];
  maxNarratives?: number;
}): Promise<OrchestratedReport> {
  let composition = await loadComposition(params.companyId, params.reportType);
  if (params.reportType === 'snapshot') {
    const units = await listCompanyIntelligenceUnits(params.companyId);
    const snapshotFloor = ensureSnapshotDecisionFloor({
      companyId: params.companyId,
      decisions: composition.decisions,
    });

    composition = composeDecisionIntelligenceFromConfig({
      companyId: params.companyId,
      reportTier: 'snapshot',
      units,
      decisions: snapshotFloor.decisions,
    });
  }
  const clusters = compressDecisionObjects({
    decisions: composition.decisions,
    maxNarratives: Math.max(1, Math.min(10, Number(params.maxNarratives ?? 10))),
  });
  const narratives = await generateNarratives({ clusters, useOptionalLlm: false });
  const trust = attachNarrativeTrust(clusters);
  const actions = buildActionPlaybooks({ clusters, narratives });

  return {
    company_id: params.companyId,
    report_type: params.reportType,
    generated_at: new Date().toISOString(),
    diagnosis: composition.diagnosis,
    narratives: stitchBundles({ clusters, narratives, trust, actions }).slice(0, 10),
  };
}

export async function buildAllOrchestratedReports(companyId: string): Promise<{
  snapshot: OrchestratedReport;
  performance: OrchestratedReport;
  growth: OrchestratedReport;
  strategic: OrchestratedReport;
}> {
  const [snapshot, performance, growth, strategic] = await Promise.all([
    buildOrchestratedReport({ companyId, reportType: 'snapshot', maxNarratives: 10 }),
    buildOrchestratedReport({ companyId, reportType: 'performance', maxNarratives: 10 }),
    buildOrchestratedReport({ companyId, reportType: 'growth', maxNarratives: 10 }),
    buildOrchestratedReport({ companyId, reportType: 'strategic', maxNarratives: 10 }),
  ]);

  return {
    snapshot,
    performance,
    growth,
    strategic,
  };
}

export function extractTopPrioritiesFromReports(params: {
  snapshot: OrchestratedReport;
  performance: OrchestratedReport;
  growth: OrchestratedReport;
  strategic: OrchestratedReport;
  limit?: number;
}): TopPriorityItem[] {
  const limit = Math.max(1, Math.min(10, Number(params.limit ?? 5)));

  const all: TopPriorityItem[] = [
    ...params.snapshot.narratives.map((bundle) => ({
      report_type: 'snapshot' as const,
      cluster_id: bundle.cluster_id,
      title: bundle.narrative.title,
      priority_score: bundle.action.priority_score,
      business_impact_score: bundle.narrative.business_impact_score,
      instruction_code: bundle.action.instruction_code,
      action_type: bundle.action.action_type,
      action_category: bundle.action.action_category,
      expected_score_gain: bundle.action.expected_score_gain,
      confidence: bundle.action.confidence,
      owner: bundle.action.owner,
      timeline_days: bundle.action.timeline_days,
    })),
    ...params.performance.narratives.map((bundle) => ({
      report_type: 'performance' as const,
      cluster_id: bundle.cluster_id,
      title: bundle.narrative.title,
      priority_score: bundle.action.priority_score,
      business_impact_score: bundle.narrative.business_impact_score,
      instruction_code: bundle.action.instruction_code,
      action_type: bundle.action.action_type,
      action_category: bundle.action.action_category,
      expected_score_gain: bundle.action.expected_score_gain,
      confidence: bundle.action.confidence,
      owner: bundle.action.owner,
      timeline_days: bundle.action.timeline_days,
    })),
    ...params.growth.narratives.map((bundle) => ({
      report_type: 'growth' as const,
      cluster_id: bundle.cluster_id,
      title: bundle.narrative.title,
      priority_score: bundle.action.priority_score,
      business_impact_score: bundle.narrative.business_impact_score,
      instruction_code: bundle.action.instruction_code,
      action_type: bundle.action.action_type,
      action_category: bundle.action.action_category,
      expected_score_gain: bundle.action.expected_score_gain,
      confidence: bundle.action.confidence,
      owner: bundle.action.owner,
      timeline_days: bundle.action.timeline_days,
    })),
    ...params.strategic.narratives.map((bundle) => ({
      report_type: 'strategic' as const,
      cluster_id: bundle.cluster_id,
      title: bundle.narrative.title,
      priority_score: bundle.action.priority_score,
      business_impact_score: bundle.narrative.business_impact_score,
      instruction_code: bundle.action.instruction_code,
      action_type: bundle.action.action_type,
      action_category: bundle.action.action_category,
      expected_score_gain: bundle.action.expected_score_gain,
      confidence: bundle.action.confidence,
      owner: bundle.action.owner,
      timeline_days: bundle.action.timeline_days,
    })),
  ];

  return all
    .sort((a, b) => {
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      if (b.business_impact_score !== a.business_impact_score) return b.business_impact_score - a.business_impact_score;
      return b.confidence - a.confidence;
    })
    .slice(0, limit);
}

export function buildSampleNarrativeOutput(): OrchestratedNarrativeBundle {
  const sampleAction: NarrativeActionPlaybook = {
    cluster_id: 'cluster_1',
    playbook_id: 'playbook_1',
    instruction_code: 'STRATEGY_ADJUSTMENT',
    target_block_id: 'pricing_page',
    impact: 74,
    expected_score_gain: 18,
    action_category: 'conversion',
    confidence: 0.84,
    confidence_per_action: 0.84,
    priority_score: 86,
    dependencies: ['TRACKING_IMPROVEMENT'],
    action_type: 'adjust_strategy',
    payload: {
      optimization_focus: 'conversion_intent_gap',
      cluster_id: 'cluster_1',
    },
    owner: 'marketing_ops',
    timeline: {
      start_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      days: 14,
    },
    objective: 'Refresh high-intent landing pages and tighten CTA relevance by segment.',
    timeline_days: 14,
    expected_kpi_lift: '18%',
    steps: [
      { step: 1, instruction: 'Prioritize the top two leaking funnel steps by impact.', owner: 'marketing_ops' },
      { step: 2, instruction: 'Deploy CTA and message variants for high-intent segments.', owner: 'content_lead' },
      { step: 3, instruction: 'Track conversion delta and close the loop in governance review.', owner: 'analytics' },
    ],
  };

  return {
    cluster_id: 'cluster_1',
    narrative: {
      cluster_id: 'cluster_1',
      title: 'Conversion intent gap on high-demand channels',
      what_is_happening: 'Five aligned decisions indicate conversion intent leakage in paid and organic channels.',
      why_it_matters: 'This cluster is high priority and directly suppresses marketing-attributed pipeline velocity.',
      what_to_do: 'Refresh high-intent landing pages and tighten CTA relevance by segment.',
      expected_outcome: 'Expected reduction in funnel leakage and improved conversion rate in the next cycle.',
      priority_score: 78,
      business_impact_score: 74,
    },
    trust: {
      cluster_id: 'cluster_1',
      confidence_level: 'high',
      confidence_score: 0.84,
      evidence: {
        decision_count: 5,
        key_signals: ['conversion_rate', 'dropoff_step', 'cta_clicks'],
      },
      data_sources: ['funnelIntelligenceService', 'trafficIntelligenceService'],
      freshness: {
        label: 'fresh',
        last_updated_at: new Date().toISOString(),
        age_hours: 2,
      },
    },
    action: sampleAction,
  };
}
