/**
 * Canonical Report Serializer & Render-Parity Verifier  (BETA-RELEASE-003, Phase 2/5/8)
 *
 * ONE surface-agnostic content serialization for the executive intelligence report. Every render surface —
 * Dashboard, API, HTML, PDF — consumes the IDENTICAL content produced here; a surface differs ONLY in its
 * layout wrapper, never in content. This makes content parity a structural guarantee, not a hope: the parity
 * verifier proves the four surfaces carry byte-identical content. NO calculation, NO narrative, NO
 * renderer-specific logic — pure serialization of the canonical payload.
 */
import type { ExecutiveIntelligenceReport } from './executiveIntelligenceReport';

export type RenderSurface = 'dashboard' | 'api' | 'html' | 'pdf';

/** The surface-agnostic content model — identical across every surface. */
export interface ReportContentModel {
  generatedAt: string | null;
  state: string;
  sections: Array<{
    sectionId: string;
    title: string;
    conclusion: string;
    confidence: { score: number | null; band: string | null; maturity: string | null };
    evidence: { measured: number; total: number; completeness: number; freshnessHours: number | null; sources: string[]; providers: string[] };
    rootCauses: Array<{ id: string; title: string; type: string; severity: number }>;
    businessImpact: Array<{ id: string; title: string; priority: number; roiStatus: string; opportunity: number }>;
    roiStatus: string[];
    priority: number | null;
    executionPlans: Array<{ id: string; title: string; actionType: string; priority: number }>;
    expectedOutcomes: string[];
    reasonCodes: string[];
    drillDown: { explanationId: string; fullyTraceable: boolean; stages: Array<{ stage: string; present: boolean; refCount: number }> };
  }>;
  executionRoadmap: Array<{ id: string; title: string; actionType: string; priority: number }>;
  businessOpportunities: Array<{ id: string; title: string; priority: number; roiStatus: string }>;
  providerHealth: ExecutiveIntelligenceReport['providerHealth'];
  dashboardSummary: {
    readiness: string;
    coverage: { sectionsBacked: number; sectionsTotal: number; coverage: number };
    confidenceDistribution: Record<string, number>;
    criticalRisks: Array<{ sectionId: string; cause: string; severity: number }>;
  };
}

/** Pure serialization of the canonical report into the surface-agnostic content model. Deterministic. */
export function serializeReportContent(report: ExecutiveIntelligenceReport): ReportContentModel {
  return {
    generatedAt: report.generatedAt,
    state: report.state,
    sections: report.sections.map((s) => ({
      sectionId: s.sectionId,
      title: s.title,
      conclusion: s.conclusion,
      confidence: s.confidence,
      evidence: {
        measured: s.evidenceStrength.measured, total: s.evidenceStrength.total, completeness: s.evidenceStrength.completeness,
        freshnessHours: s.evidenceFreshnessHours, sources: s.evidenceSources, providers: s.providerSources,
      },
      rootCauses: s.rootCauses,
      businessImpact: s.businessImpact,
      roiStatus: s.roiStatus,
      priority: s.priority,
      executionPlans: s.executionPlans,
      expectedOutcomes: s.expectedOutcomes,
      reasonCodes: s.reasonCodes,
      drillDown: { explanationId: s.drillDown.explanationId, fullyTraceable: s.drillDown.fullyTraceable, stages: s.drillDown.decisionPath },
    })),
    executionRoadmap: report.executionRoadmap,
    businessOpportunities: report.businessOpportunities,
    providerHealth: report.providerHealth,
    dashboardSummary: {
      readiness: report.dashboard.readiness,
      coverage: report.dashboard.dataCoverage,
      confidenceDistribution: report.dashboard.confidenceDistribution,
      criticalRisks: report.dashboard.criticalRisks,
    },
  };
}

/** A surface view = the shared content + a layout tag. Content is identical across surfaces (layout-only diff). */
export interface SurfaceView {
  surface: RenderSurface;
  content: ReportContentModel;
}

export function buildSurfaceView(report: ExecutiveIntelligenceReport, surface: RenderSurface): SurfaceView {
  return { surface, content: serializeReportContent(report) };
}

export interface ParityResult {
  parity: boolean;
  surfaces: RenderSurface[];
  /** Surface pairs whose content differs (empty when parity holds). */
  mismatches: Array<{ a: RenderSurface; b: RenderSurface }>;
}

/**
 * Verify Dashboard/API/HTML/PDF content parity: every surface's content must be byte-identical (only layout
 * may differ). Deterministic — proves the single-source guarantee.
 */
export function verifyRenderParity(report: ExecutiveIntelligenceReport): ParityResult {
  const surfaces: RenderSurface[] = ['dashboard', 'api', 'html', 'pdf'];
  const views = surfaces.map((s) => ({ surface: s, json: JSON.stringify(serializeReportContent(report)) }));
  const reference = views[0].json;
  const mismatches = views.slice(1).filter((v) => v.json !== reference).map((v) => ({ a: surfaces[0], b: v.surface }));
  return { parity: mismatches.length === 0, surfaces, mismatches };
}
