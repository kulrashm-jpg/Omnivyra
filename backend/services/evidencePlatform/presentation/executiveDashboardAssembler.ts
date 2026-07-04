/**
 * Executive Dashboard Assembler  (BETA-FINAL-001, Phase 4)
 *
 * A deterministic, READ-ONLY dashboard view model composed from existing intelligence — provider health,
 * evidence freshness, confidence distribution, data coverage, opportunities, and risks. NO new calculation,
 * NO scoring change, NO fabrication: with no live evidence the dashboard honestly reports an
 * "awaiting activation" state. Presentation only.
 */
import type { ExecutiveSectionView } from './executivePresentationAssembler';
import type { ProviderActivation } from './providerActivationMatrix';
import { summarizeActivation } from './providerActivationMatrix';

export interface ExecutiveDashboard {
  /** Overall readiness of the intelligence pipeline for THIS tenant (data availability, not a score). */
  readiness: 'awaiting_activation' | 'partially_active' | 'active';
  providerHealth: {
    implemented: number; active: number; awaitingCredentials: number; notImplemented: number; migrationPending: boolean;
    providers: Array<{ providerId: string; status: string; domain: string }>;
  };
  evidenceFreshness: { freshestHours: number | null; stalestHours: number | null; sectionsWithEvidence: number; sectionsTotal: number };
  confidenceDistribution: Record<string, number>; // band → count of sections
  dataCoverage: { sectionsBacked: number; sectionsTotal: number; coverage: number };
  businessOpportunities: Array<{ id: string; title: string; priority: number; roiStatus: string }>;
  criticalRisks: Array<{ sectionId: string; cause: string; severity: number }>;
  priorityRoadmap: Array<{ id: string; title: string; actionType: string; priority: number }>;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Compose the dashboard from the already-assembled executive sections + the provider activation matrix. */
export function assembleExecutiveDashboard(sections: ExecutiveSectionView[], activation: ProviderActivation[]): ExecutiveDashboard {
  const act = summarizeActivation(activation);
  const backed = sections.filter((s) => s.conclusion === 'evidence_backed');
  const freshHours = sections.map((s) => s.evidenceFreshnessHours).filter((h): h is number => h != null);

  const confidenceDistribution: Record<string, number> = {};
  for (const s of sections) { const band = s.confidence.band ?? 'none'; confidenceDistribution[band] = (confidenceDistribution[band] ?? 0) + 1; }

  // SINGLE SOURCE OF TRUTH for opportunities + roadmap (de-duplicated + priority-ordered). The report
  // composer references these — it does NOT recompute them (BETA-RELEASE-003: no duplicate composition).
  const dedupById = <T extends { id: string }>(xs: T[]): T[] => {
    const seen = new Set<string>();
    return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };
  const opportunities = dedupById(sections.flatMap((s) => s.businessImpact))
    .sort((a, b) => (b.priority - a.priority) || (a.id < b.id ? -1 : 1));

  const risks = sections
    .flatMap((s) => s.rootCauses.filter((c) => c.type === 'blocking_cause' || c.type === 'primary_cause').map((c) => ({ sectionId: s.sectionId, cause: c.title, severity: c.severity })))
    .sort((a, b) => (b.severity - a.severity) || (a.cause < b.cause ? -1 : 1));

  const roadmap = dedupById(sections.flatMap((s) => s.executionPlans))
    .sort((a, b) => (b.priority - a.priority) || (a.id < b.id ? -1 : 1));

  const readiness: ExecutiveDashboard['readiness'] =
    act.active === 0 ? 'awaiting_activation' : act.awaitingCredentials > 0 ? 'partially_active' : 'active';

  return {
    readiness,
    providerHealth: {
      implemented: act.implemented, active: act.active, awaitingCredentials: act.awaitingCredentials,
      notImplemented: act.notImplemented, migrationPending: act.migrationPending,
      providers: activation.filter((p) => p.implemented).map((p) => ({ providerId: p.providerId, status: p.status, domain: p.domain })),
    },
    evidenceFreshness: {
      freshestHours: freshHours.length ? Math.min(...freshHours) : null,
      stalestHours: freshHours.length ? Math.max(...freshHours) : null,
      sectionsWithEvidence: backed.length, sectionsTotal: sections.length,
    },
    confidenceDistribution,
    dataCoverage: { sectionsBacked: backed.length, sectionsTotal: sections.length, coverage: sections.length ? round(backed.length / sections.length) : 0 },
    businessOpportunities: opportunities,
    criticalRisks: risks,
    priorityRoadmap: roadmap,
  };
}
