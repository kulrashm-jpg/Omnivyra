/**
 * Executive Explainability Engine  (BETA-ENGINE-013, Phase 2/4)
 *
 * ONE reusable engine that composes the platform's existing deterministic outputs into a single auditable
 * `Explanation` per executive conclusion. It DOES NOT recompute or narrate anything — it references what the
 * Evidence / Validation / Correlation / Root-Cause / Recommendation / Business-Impact engines already
 * produced, and assembles the ordered decision path so every conclusion is reproducible + traceable
 * (Evidence → Validation → Correlation → Root Cause → Recommendation → Business Impact → Commercial ROI →
 * Confidence → Decision). NO AI, NO narrative generation, NO scoring redesign — pure + deterministic.
 */
import type { Evidence } from '../evidenceModel';
import type { CorrelatedEvidence } from '../correlation/correlationModel';
import type { RootCause } from '../rootcause/rootCauseModel';
import type { ExecutionPlan } from '../recommendation/recommendationModel';
import type { BusinessImpact } from '../business/businessImpactModel';
import type { ConfidenceReadout } from '../confidenceEngine';
import { hasMeasuredEvidence } from '../evidenceAwareConfidence';
import { COMMERCIAL_CONTEXT_KEYS } from '../business/businessRuleRegistry';
import type { Explanation, ExplanationStage } from './explanationModel';

const keyOf = (e: Evidence): string => e.id?.split(':').pop() ?? '';
const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

export interface ExplanationInput {
  decisionId: string;
  /** The validated evidence the decision consumed (post-governance). */
  evidence?: Evidence[] | null;
  /** Evidence keys governance REJECTED (never influenced the decision), for the "ignored" audit trail. */
  rejectedEvidenceKeys?: string[] | null;
  correlations?: CorrelatedEvidence[] | null;
  rootCauses?: RootCause[] | null;
  recommendations?: ExecutionPlan[] | null;
  businessImpact?: BusinessImpact[] | null;
  confidence?: ConfidenceReadout | null;
  freshnessAt?: string | null;
}

/**
 * Build the canonical, auditable Explanation for one executive conclusion. Deterministic: identical inputs
 * yield an identical artifact. Every field is a REFERENCE to an already-produced platform output.
 */
export function buildExplanation(input: ExplanationInput): Explanation {
  const evidence = input.evidence ?? [];
  const correlations = input.correlations ?? [];
  const rootCauses = input.rootCauses ?? [];
  const recommendations = input.recommendations ?? [];
  const businessImpact = input.businessImpact ?? [];

  const measured = evidence.filter((e) => e.maturity !== 'UNAVAILABLE' && e.value != null);
  const evidenceUsed = uniq(measured.map(keyOf));
  const assertedCorrelations = correlations.filter((c) => c.confidence > 0);
  const correlationRules = uniq(assertedCorrelations.map((c) => c.ruleId));
  const rootCauseIds = uniq(rootCauses.filter((c) => c.causeType !== 'missing_cause').map((c) => c.causeId));
  const recommendationRules = uniq(recommendations.map((p) => p.ruleId));
  const businessRules = uniq(businessImpact.map((b) => b.ruleId));
  const commercialEvidence = uniq(evidenceUsed.filter((k) => (COMMERCIAL_CONTEXT_KEYS as readonly string[]).includes(k)));
  const roiStatuses = uniq(businessImpact.map((b) => b.roi.status));
  const providerProvenance = uniq(measured.map((e) => e.engineId).filter((v): v is string => !!v));

  const reasonCodes = uniq([
    ...assertedCorrelations.map((c) => c.reasonCode),
    ...rootCauses.flatMap((c) => c.reasonCodes),
    ...recommendations.flatMap((p) => p.reasonCodes),
    ...businessImpact.flatMap((b) => b.reasonCodes),
    ...(input.confidence?.reasonCodes ?? []),
  ]);

  // Ordered decision path — each stage `present` iff it genuinely contributed.
  const stage = (s: ExplanationStage['stage'], present: boolean, refs: string[], detail: string): ExplanationStage => ({ stage: s, present, refs: uniq(refs), detail });
  const decisionPath: ExplanationStage[] = [
    stage('evidence', hasMeasuredEvidence(evidence), evidenceUsed, `${measured.length} measured evidence row(s) consumed`),
    stage('validation', measured.length > 0 || (input.rejectedEvidenceKeys?.length ?? 0) > 0, input.rejectedEvidenceKeys ?? [], `${input.rejectedEvidenceKeys?.length ?? 0} row(s) rejected pre-decision; measured evidence validated`),
    stage('correlation', assertedCorrelations.length > 0, correlationRules, `${assertedCorrelations.length} correlation(s) asserted across evidence domains`),
    stage('root_cause', rootCauseIds.length > 0, rootCauseIds, `${rootCauseIds.length} root cause(s) diagnosed from the correlations`),
    stage('recommendation', recommendationRules.length > 0, recommendationRules, `${recommendationRules.length} execution plan(s) generated from the root causes`),
    stage('business_impact', businessRules.length > 0, businessRules, `${businessRules.length} business initiative(s) prioritised from the plans`),
    stage('commercial_roi', commercialEvidence.length > 0 || roiStatuses.length > 0, [...roiStatuses, ...commercialEvidence], `ROI: ${roiStatuses.join('/') || 'not_assessed'}${commercialEvidence.length ? ` (commercial evidence: ${commercialEvidence.join(', ')})` : ''}`),
    stage('confidence', Boolean(input.confidence), input.confidence?.reasonCodes ?? [], input.confidence ? `confidence ${input.confidence.confidenceScore} (${input.confidence.confidenceBand}), maturity ${input.confidence.maturity}` : 'no confidence readout'),
    stage('decision', true, [input.decisionId], 'decision emitted with the full reasoning chain attached'),
  ];

  const calculationProvenance = decisionPath.filter((s) => s.present && ['correlation', 'root_cause', 'business_impact', 'commercial_roi', 'confidence'].includes(s.stage)).map((s) => s.stage);

  return {
    explanationId: `explain:${input.decisionId}`,
    decisionId: input.decisionId,
    decisionPath,
    evidenceUsed,
    evidenceIgnored: uniq(input.rejectedEvidenceKeys ?? []),
    correlationRules,
    rootCauses: rootCauseIds,
    recommendationRules,
    businessRules,
    commercialEvidence,
    roiStatuses,
    confidenceBreakdown: input.confidence?.breakdown ?? [],
    reasonCodes,
    providerProvenance,
    calculationProvenance,
    validationStatus: 'validated',
    freshnessAt: input.freshnessAt ?? (measured.length > 0 ? (measured[0]?.observedAt ?? null) : null),
  };
}

/** Deterministic traceability (Phase 4): the ordered, reproducible decision path from evidence to decision. */
export function traceExplanation(explanation: Explanation): ExplanationStage[] {
  return explanation.decisionPath;
}

/** Trace which stage a given reason code / reference belongs to (deterministic lookup). */
export function traceReference(explanation: Explanation, ref: string): ExplanationStage | null {
  return explanation.decisionPath.find((s) => s.refs.includes(ref)) ?? null;
}

/** A compact, persistable explanation summary for a decision's explainability block. */
export interface ExplanationSummary {
  explanationId: string;
  decisionPath: Array<{ stage: string; present: boolean; refCount: number }>;
  evidenceUsed: number;
  evidenceIgnored: number;
  reasonCodes: string[];
  roiStatuses: string[];
  fullyTraceable: boolean;
}

export function summarizeExplanation(explanation: Explanation): ExplanationSummary {
  return {
    explanationId: explanation.explanationId,
    decisionPath: explanation.decisionPath.map((s) => ({ stage: s.stage, present: s.present, refCount: s.refs.length })),
    evidenceUsed: explanation.evidenceUsed.length,
    evidenceIgnored: explanation.evidenceIgnored.length,
    reasonCodes: explanation.reasonCodes,
    roiStatuses: explanation.roiStatuses,
    // Fully traceable when the core reasoning stages are all present (evidence → … → decision).
    fullyTraceable: ['evidence', 'correlation', 'root_cause', 'recommendation', 'business_impact'].every((st) => explanation.decisionPath.find((s) => s.stage === st)?.present),
  };
}
