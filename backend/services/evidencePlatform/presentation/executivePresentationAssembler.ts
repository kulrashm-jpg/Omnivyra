/**
 * Executive Presentation Assembler  (BETA-FINAL-001, Phase 2/3)
 *
 * A deterministic, READ-ONLY view-model assembler. It surfaces the intelligence the platform already
 * produced — evidence, provenance, confidence, correlations, root causes, recommendations, business impact,
 * ROI, explanation — into an executive section shape with drill-down. It generates NO narrative, performs NO
 * calculation, and changes NO score. Every field is a reference to an existing artifact (nothing is a black
 * box). Presentation only.
 */
import type { RootCause } from '../rootcause/rootCauseModel';
import type { ExecutionPlan } from '../recommendation/recommendationModel';
import type { BusinessImpact } from '../business/businessImpactModel';
import type { CorrelatedEvidence } from '../correlation/correlationModel';
import type { Evidence } from '../evidenceModel';
import type { ConfidenceReadout } from '../confidenceEngine';
import { hasMeasuredEvidence, summarizeEvidence } from '../evidenceAwareConfidence';
import { buildExplanation, summarizeExplanation, type ExplanationSummary } from '../explainability/explainabilityEngine';

export interface ExecutiveSectionInput {
  sectionId: string;
  title: string;
  evidence?: Evidence[] | null;
  rejectedEvidenceKeys?: string[] | null;
  correlations?: CorrelatedEvidence[] | null;
  rootCauses?: RootCause[] | null;
  recommendations?: ExecutionPlan[] | null;
  businessImpact?: BusinessImpact[] | null;
  confidence?: ConfidenceReadout | null;
  /** ISO — the "now" used for freshness display (deterministic; passed in). */
  nowIso?: string | null;
}

export interface ExecutiveSectionView {
  sectionId: string;
  title: string;
  /** Overall conclusion state — driven by data presence, never fabricated. */
  conclusion: 'evidence_backed' | 'awaiting_evidence';
  confidence: { score: number | null; band: string | null; maturity: string | null };
  evidenceStrength: { measured: number; total: number; completeness: number };
  evidenceFreshnessHours: number | null;
  evidenceSources: string[];
  providerSources: string[];
  rootCauses: Array<{ id: string; title: string; type: string; severity: number }>;
  businessImpact: Array<{ id: string; title: string; priority: number; roiStatus: string; opportunity: number }>;
  roiStatus: string[];
  priority: number | null; // top business priority
  executionPlans: Array<{ id: string; title: string; actionType: string; priority: number }>;
  expectedOutcomes: string[];
  reasonCodes: string[];
  /** Full drill-down chain (evidence → … → decision), from the Explanation engine. */
  drillDown: ExplanationSummary;
}

const round = (n: number): number => Math.round(n * 100) / 100;

function ageHours(iso: string | null | undefined, nowIso: string | null | undefined): number | null {
  if (!iso || !nowIso) return null;
  const a = Date.parse(iso); const b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, round((b - a) / 3_600_000));
}

/** Assemble one executive section view model. Deterministic; read-only. */
export function assembleExecutiveSection(input: ExecutiveSectionInput): ExecutiveSectionView {
  const evidence = input.evidence ?? [];
  const summary = summarizeEvidence(evidence);
  const backed = hasMeasuredEvidence(evidence);
  const rootCauses = (input.rootCauses ?? []).filter((c) => c.causeType !== 'missing_cause');
  const business = (input.businessImpact ?? []);
  const plans = (input.recommendations ?? []);
  const freshest = evidence.map((e) => e.observedAt).filter((t): t is string => !!t).sort().slice(-1)[0] ?? null;

  const explanation = buildExplanation({
    decisionId: input.sectionId, evidence, rejectedEvidenceKeys: input.rejectedEvidenceKeys,
    correlations: input.correlations, rootCauses: input.rootCauses, recommendations: input.recommendations,
    businessImpact: input.businessImpact, confidence: input.confidence,
  });

  return {
    sectionId: input.sectionId,
    title: input.title,
    conclusion: backed ? 'evidence_backed' : 'awaiting_evidence',
    confidence: { score: input.confidence?.confidenceScore ?? null, band: input.confidence?.confidenceBand ?? null, maturity: input.confidence?.maturity ?? null },
    evidenceStrength: { measured: summary.measured, total: summary.total, completeness: round(summary.completeness) },
    evidenceFreshnessHours: ageHours(freshest, input.nowIso),
    evidenceSources: summary.measuredKeys,
    providerSources: [...new Set(evidence.filter((e) => e.maturity !== 'UNAVAILABLE').map((e) => e.engineId).filter((v): v is string => !!v))],
    rootCauses: rootCauses.map((c) => ({ id: c.causeId, title: c.title, type: c.causeType, severity: c.severity })),
    businessImpact: business.map((b) => ({ id: b.impactId, title: b.title, priority: b.businessPriority, roiStatus: b.roi.status, opportunity: b.opportunitySize })),
    roiStatus: [...new Set(business.map((b) => b.roi.status))],
    priority: business.length ? Math.max(...business.map((b) => b.businessPriority)) : null,
    executionPlans: plans.map((p) => ({ id: p.recommendationId, title: p.title, actionType: p.actionType, priority: p.priority })),
    expectedOutcomes: [...new Set(plans.map((p) => p.expectedBusinessOutcome))],
    reasonCodes: explanation.reasonCodes,
    drillDown: summarizeExplanation(explanation),
  };
}
