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
  strategic_playbook: CanonicalReport['strategic_playbook'];
  ai_surface_presence: CanonicalReport['ai_surface_presence'];
  knowledge_graph: CanonicalReport['knowledge_graph'];
  authority_inflow: CanonicalReport['authority_inflow'];
  trust_coherence: CanonicalReport['trust_coherence'];
  benchmark: CanonicalReport['benchmark'];
  competitive_surface_share: CanonicalReport['competitive_surface_share'];
  change_intelligence: CanonicalReport['change_intelligence'];
  forecast: CanonicalReport['forecast'];

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
    strategic_playbook: report.strategic_playbook,
    ai_surface_presence: report.ai_surface_presence,
    knowledge_graph: report.knowledge_graph,
    authority_inflow: report.authority_inflow,
    trust_coherence: report.trust_coherence,
    benchmark: report.benchmark,
    competitive_surface_share: report.competitive_surface_share,
    change_intelligence: report.change_intelligence,
    forecast: report.forecast,
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
