/**
 * Executive Intelligence Report Composer  (BETA-RELEASE-002, Phase 2/3)
 *
 * The ONE canonical, serializable executive-report payload — the single source the HTML, PDF, API and
 * Dashboard all consume (one view model, four surfaces; no duplicated presentation logic). It composes the
 * already-built read-only view models (executive sections + dashboard + provider health) into a business-
 * first ordered report. It generates NO narrative, computes NO score, and fabricates nothing — with no
 * evidence the report is honest-empty (`awaiting_evidence` / `awaiting_activation`). Presentation only.
 */
import type { ExecutiveSectionView } from './executivePresentationAssembler';
import { assembleExecutiveDashboard, type ExecutiveDashboard } from './executiveDashboardAssembler';
import type { ProviderActivation } from './providerActivationMatrix';
import type { ProviderHealthDashboard } from './providerHealthDashboard';

export interface ExecutiveIntelligenceReport {
  /** ISO — the moment the report view model was assembled (passed in; deterministic). */
  generatedAt: string | null;
  /** Overall state driven by real provider/data availability — never a placeholder. */
  state: 'awaiting_activation' | 'partially_active' | 'active';
  dashboard: ExecutiveDashboard;
  /** Business-first ordered sections (by top business priority, then evidence presence). */
  sections: ExecutiveSectionView[];
  providerHealth: {
    tableHealthy: boolean; migrationStatus: 'applied' | 'pending';
    implemented: number; connected: number; awaitingCredentials: number; persistedRecords: number;
    providers: Array<{ providerId: string; status: string; domain: string; evidenceCount: number; lastSync: string | null }>;
  };
  /** A flat, de-duplicated, priority-ordered execution roadmap across all sections. */
  executionRoadmap: Array<{ id: string; title: string; actionType: string; priority: number }>;
  /** Top business opportunities across all sections (priority-ordered). */
  businessOpportunities: Array<{ id: string; title: string; priority: number; roiStatus: string }>;
}

export interface ReportComposeInput {
  sections: ExecutiveSectionView[];
  activation: ProviderActivation[];
  providerHealth?: ProviderHealthDashboard | null;
  generatedAt?: string | null;
}

/** Compose the canonical executive intelligence report. Deterministic; read-only. */
export function composeExecutiveIntelligenceReport(input: ReportComposeInput): ExecutiveIntelligenceReport {
  // Business-first ordering: sections with higher top-priority first, evidence-backed before awaiting.
  const sections = [...input.sections].sort((a, b) => {
    const pa = a.priority ?? -1; const pb = b.priority ?? -1;
    if (pb !== pa) return pb - pa;
    if (a.conclusion !== b.conclusion) return a.conclusion === 'evidence_backed' ? -1 : 1;
    return a.sectionId < b.sectionId ? -1 : 1;
  });

  const dashboard = assembleExecutiveDashboard(sections, input.activation);

  // BETA-RELEASE-003: single source of truth — the roadmap + opportunities come from the dashboard (already
  // de-duplicated + priority-ordered). The composer does NOT recompute them (no duplicate composition).
  const executionRoadmap = dashboard.priorityRoadmap;
  const businessOpportunities = dashboard.businessOpportunities;

  const ph = input.providerHealth;
  return {
    generatedAt: input.generatedAt ?? null,
    state: dashboard.readiness,
    dashboard,
    sections,
    providerHealth: ph
      ? {
          tableHealthy: ph.tableHealthy, migrationStatus: ph.migrationStatus,
          implemented: ph.summary.implemented, connected: ph.summary.connected,
          awaitingCredentials: ph.summary.awaitingCredentials, persistedRecords: ph.summary.persistedRecords,
          providers: ph.providers.map((p) => ({ providerId: p.providerId, status: p.status, domain: p.domain, evidenceCount: p.evidenceCount, lastSync: p.lastSync })),
        }
      : {
          tableHealthy: false, migrationStatus: 'pending',
          implemented: dashboard.providerHealth.implemented, connected: dashboard.providerHealth.active,
          awaitingCredentials: dashboard.providerHealth.awaitingCredentials, persistedRecords: 0,
          providers: dashboard.providerHealth.providers.map((p) => ({ providerId: p.providerId, status: p.status, domain: p.domain, evidenceCount: 0, lastSync: null })),
        },
    executionRoadmap,
    businessOpportunities,
  };
}
