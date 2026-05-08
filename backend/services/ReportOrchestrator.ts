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

// TopPriorityItem type removed in Phase 2 — superseded by CanonicalAction.

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
  const composition = await loadComposition(params.companyId, params.reportType);
  // Canonical Trust Foundation: no synthetic decision floor. If evidence is sparse,
  // the report renders fewer narratives — by design. We do not fabricate decisions
  // to hit a minimum count.
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

// Phase 2 deletion: extractTopPrioritiesFromReports and buildSampleNarrativeOutput were
// dead code (no callers in the codebase) and have been removed. Top priorities now flow
// through the canonical Action Playbook on the snapshot report.
//
// TopPriorityItem type also removed since it was only used by the deleted aggregator.
