// Canonical export.
//
// Phase 6 mandates: every export consumes `canonical.*` ONLY. No legacy
// SEO summary exports, no obsolete PDF mappings. The export shape preserves
// explainability, evidence references, confidence semantics, and maturity
// semantics — the boardroom artifact carries the same trust signals as the
// in-app report.
//
// This module ships TWO export shapes — Executive (concise) and Analyst
// (full evidence appendix). Both are JSON payloads that downstream PDF /
// HTML / shareable-link generators consume. The renderers themselves live
// in their respective tools (the export pipeline already exists in the
// codebase); Phase 6's contribution is the canonical payload contract.

import type { CanonicalReport, PillarKey } from '../canonicalReport/canonicalReportTypes';
// GAP-01 — type-only re-use of the Report 1 producer's own declarations. No parallel schema.
import type { SnapshotReport } from '../snapshotReportTypes';
import type { ComparisonView } from './comparisonEngine';
import type { ExplanationIndex, Explanation } from './explainabilityEngine';
import { buildExplanationIndex } from './explainabilityEngine';

export type ExportShape = 'executive' | 'analyst' | 'snapshot';

export type CanonicalExportPayload = {
  shape: ExportShape;
  generated_at: string;
  tenant_id: string;
  company_id: string;
  /** Stable identifier readers can resolve to the snapshot in the historical store. */
  snapshot_observed_at: string | null;
  /** Optional shareable-link token (caller fills it). */
  shareable_link: { token: string; expires_at: string } | null;

  // ── Always-present ────────────────────────────────────────────────────────
  authority_overview: CanonicalReport['authority_overview'];
  maturity_stage: CanonicalReport['maturity_stage'];
  pillars: CanonicalReport['pillars'];
  executive_insights: CanonicalReport['executive_insights'];
  scan_metadata: CanonicalReport['scan_metadata'];

  // ── Executive + analyst ───────────────────────────────────────────────────
  action_playbook: CanonicalReport['action_playbook'];
  improvement_todos: CanonicalReport['improvement_todos'];
  strategic_playbook: CanonicalReport['strategic_playbook'];
  ai_surface_presence: CanonicalReport['ai_surface_presence'];
  knowledge_graph: CanonicalReport['knowledge_graph'];
  authority_inflow: CanonicalReport['authority_inflow'];
  trust_coherence: CanonicalReport['trust_coherence'];
  benchmark: CanonicalReport['benchmark'];
  competitive_surface_share: CanonicalReport['competitive_surface_share'];
  change_intelligence: CanonicalReport['change_intelligence'];
  forecast: CanonicalReport['forecast'];
  /** BETA-REPORT-EXEC-010: carry the payload-truth fields (EXEC-005/007/009) so the dossier can render them.
   *  Optional for backward compatibility; the renderer shows them only when present/material. */
  authority_trajectory?: CanonicalReport['authority_trajectory'];
  commercial_roi?: CanonicalReport['commercial_roi'];
  override_disclosure?: CanonicalReport['override_disclosure'];
  evidence_readiness?: CanonicalReport['evidence_readiness'];
  /** BETA-PHASE0-EXEC-001: carry the non-scored Declared Evidence section (EVIDENCE-EXEC-003) into the
   *  HTML/PDF export so it is no longer in-app-only. Optional/additive; rendered only when present + material. */
  declared_evidence?: CanonicalReport['declared_evidence'];

  // ── Report 1 surfaces (GAP-01) ────────────────────────────────────────────
  //
  // `canonical` owns scores, pillars, playbook and evidence trace. The five fields below are the
  // Report 1 surfaces the canonical builder does NOT own — they are produced by the Phase 3/4
  // modules and by `digitalSnapshotAssembly`, and previously stopped at `SnapshotReport` because
  // this payload had no slot for them. Strict pass-through: nothing here is recomputed, and an
  // absent field means the producer abstained, so the renderer omits the section.
  report1?: {
    digital_snapshot: SnapshotReport['digital_snapshot'] | null;
    evidence_coverage: SnapshotReport['evidence_coverage'] | null;
    digital_experience: SnapshotReport['digital_experience'] | null;
    performance: SnapshotReport['performance'] | null;
    competitive_tables: SnapshotReport['competitive_tables'] | null;
    /** GAP-09 — crawl outcome + SERP state for this run. */
    evidence_acquisition: SnapshotReport['evidence_acquisition'] | null;
    /** GAP-06 — public-domain search visibility. */
    search_visibility: SnapshotReport['search_visibility'] | null;
    /** GAP-08 — identity fields with explicit provenance. */
    company_identity: SnapshotReport['company_identity'] | null;
    /** GAP-10 — per-check website evidence. Null when nothing was evaluable. */
    website_checks: SnapshotReport['website_checks'] | null;
  };

  // ── Analyst-only: evidence appendix + per-axis explanations ──────────────
  evidence_appendix?: {
    overall: CanonicalReport['evidence_trace']['overall'];
    by_pillar: Partial<Record<PillarKey, CanonicalReport['evidence_trace']['by_pillar'][PillarKey]>>;
    by_dimension: CanonicalReport['evidence_trace']['by_dimension'];
  };
  explanations?: ExplanationIndex;
  comparison?: ComparisonView;

  // ── Snapshot-only: minimal payload optimized for shareable links ─────────
  snapshot_summary?: {
    overall_value: number | null;
    overall_band: string;
    maturity_label: string;
    headline_thesis: string;
  };
};

export function buildCanonicalExport(params: {
  shape: ExportShape;
  tenantId: string;
  companyId: string;
  report: CanonicalReport;
  /** GAP-01 — Report 1 surfaces carried beside the canonical report. Omitted for legacy callers. */
  report1?: CanonicalExportPayload['report1'];
  comparison?: ComparisonView;
  shareable_link?: { token: string; expires_at: string } | null;
}): CanonicalExportPayload {
  const { shape, report } = params;
  const explanationIndex = shape === 'analyst' ? buildExplanationIndex(report) : undefined;

  const base: CanonicalExportPayload = {
    shape,
    generated_at: new Date().toISOString(),
    tenant_id: params.tenantId,
    company_id: params.companyId,
    snapshot_observed_at: report.scan_metadata.persisted_at,
    shareable_link: params.shareable_link ?? null,

    authority_overview: report.authority_overview,
    maturity_stage: report.maturity_stage,
    pillars: report.pillars,
    executive_insights: report.executive_insights,
    scan_metadata: report.scan_metadata,

    action_playbook: report.action_playbook,
    improvement_todos: report.improvement_todos,
    strategic_playbook: report.strategic_playbook,
    ai_surface_presence: report.ai_surface_presence,
    knowledge_graph: report.knowledge_graph,
    authority_inflow: report.authority_inflow,
    trust_coherence: report.trust_coherence,
    benchmark: report.benchmark,
    competitive_surface_share: report.competitive_surface_share,
    change_intelligence: report.change_intelligence,
    forecast: report.forecast,
    // BETA-REPORT-EXEC-010: pass-through of payload truth (no recompute, no derivation).
    authority_trajectory: report.authority_trajectory,
    commercial_roi: report.commercial_roi,
    override_disclosure: report.override_disclosure,
    evidence_readiness: report.evidence_readiness,
    // BETA-PHASE0-EXEC-001: non-scored Declared Evidence pass-through (no recompute, no derivation).
    declared_evidence: report.declared_evidence,
    // GAP-01: Report 1 surfaces pass-through (no recompute, no derivation). Present in every
    // shape — the Report 1 decision layer is not an executive-only concern.
    report1: params.report1,
  };

  if (shape === 'snapshot') {
    return {
      ...base,
      snapshot_summary: {
        overall_value: report.authority_overview.overall_score.value,
        overall_band: report.authority_overview.overall_score.band,
        maturity_label: report.maturity_stage.label,
        headline_thesis: report.executive_insights.headline_thesis.text,
      },
    };
  }

  if (shape === 'analyst') {
    return {
      ...base,
      evidence_appendix: {
        overall: report.evidence_trace.overall,
        by_pillar: report.evidence_trace.by_pillar,
        by_dimension: report.evidence_trace.by_dimension,
      },
      explanations: explanationIndex,
      comparison: params.comparison,
    };
  }

  // executive shape
  return base;
}
