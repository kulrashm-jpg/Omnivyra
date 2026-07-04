/**
 * Executive Root Cause Engine  (BETA-ENGINE-010, Phase 2)
 *
 * ONE reusable engine that turns correlated evidence into deterministic root-cause diagnoses. It consumes
 * only the `CorrelatedEvidence` produced by BETA-ENGINE-009 (which itself only carries validated, measured
 * evidence), evaluates the registry rules, and emits explainable `RootCause` artifacts. When the evidence
 * required for a diagnosis is missing it emits a `missing_cause` (never fabricates a cause). NO AI, NO
 * probability — pure + deterministic.
 */
import type { CorrelatedEvidence } from '../correlation/correlationModel';
import type { RootCause, SeverityBand } from './rootCauseModel';
import { ROOT_CAUSE_RULES, rootCauseRulesForConsumer, type RootCauseRule, type RootCauseRuleContext } from './rootCauseRuleRegistry';

const round = (n: number): number => Math.round(n * 10000) / 10000;

function severityBand(severity: number): SeverityBand {
  if (severity >= 80) return 'critical';
  if (severity >= 60) return 'high';
  if (severity >= 35) return 'medium';
  if (severity > 0) return 'low';
  return 'none';
}

function buildContext(correlations: CorrelatedEvidence[]): { ctx: RootCauseRuleContext; missing: CorrelatedEvidence[] } {
  const asserted = new Map<string, CorrelatedEvidence>();
  const all = new Map<string, CorrelatedEvidence>();
  const missing: CorrelatedEvidence[] = [];
  for (const c of correlations) {
    all.set(c.ruleId, c);
    if (c.confidence > 0) asserted.set(c.ruleId, c);
    if (c.relationshipType === 'missing_supporting_evidence') missing.push(c);
  }
  return { ctx: { asserted, all }, missing };
}

function toRootCause(rule: RootCauseRule, ctx: RootCauseRuleContext): RootCause | null {
  const outcome = rule.evaluate(ctx);
  if (!outcome) return null;
  // Confidence = mean of the supporting correlations' confidence (deterministic, measured-only).
  const confs = outcome.supportingCorrelations
    .map((id) => ctx.asserted.get(id)?.confidence)
    .filter((v): v is number => typeof v === 'number');
  const confidence = confs.length ? round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
  const freshTimes = outcome.supportingCorrelations
    .map((id) => ctx.asserted.get(id)?.freshnessAt)
    .filter((t): t is string => !!t);
  return {
    causeId: rule.id, causeType: outcome.causeType, title: outcome.title,
    severity: outcome.severity, severityBand: severityBand(outcome.severity), confidence,
    supportingEvidence: outcome.supportingEvidence, supportingCorrelations: outcome.supportingCorrelations,
    missingEvidence: [], conflictingEvidence: outcome.conflictingEvidence, blockingDependencies: outcome.blockingDependencies,
    explanation: outcome.explanation, reasonCodes: [outcome.reasonCode], validationStatus: 'validated',
    freshnessAt: freshTimes.length ? freshTimes.sort().slice(-1)[0] : null, decisionConsumers: rule.decisionConsumers,
  };
}

function evaluateRules(rules: RootCauseRule[], correlations: CorrelatedEvidence[]): RootCause[] {
  const { ctx, missing } = buildContext(correlations);
  const causes = rules.map((r) => toRootCause(r, ctx)).filter((c): c is RootCause => c !== null);

  // If no cause could be diagnosed but correlations were attempted and lacked evidence → a missing_cause.
  if (causes.length === 0 && missing.length > 0) {
    causes.push({
      causeId: 'missing_diagnostic_evidence', causeType: 'missing_cause', title: 'Insufficient Diagnostic Evidence',
      severity: 0, severityBand: 'none', confidence: 0,
      supportingEvidence: [], supportingCorrelations: [],
      missingEvidence: [...new Set(missing.flatMap((m) => m.missingMeasurements))],
      conflictingEvidence: [], blockingDependencies: [],
      explanation: `No root cause could be diagnosed — required evidence is missing (${missing.map((m) => m.ruleId).join(', ')}).`,
      reasonCodes: ['RC_MISSING_DIAGNOSTIC_EVIDENCE'], validationStatus: 'validated', freshnessAt: null,
      decisionConsumers: [],
    });
  }
  // Deterministic ordering: blocking/primary first, then by severity desc, then causeId.
  const rank: Record<string, number> = { blocking_cause: 0, primary_cause: 1, contributing_cause: 2, conflicting_cause: 3, dependent_cause: 4, resolved_cause: 5, missing_cause: 6 };
  return causes.sort((a, b) => (rank[a.causeType] - rank[b.causeType]) || (b.severity - a.severity) || (a.causeId < b.causeId ? -1 : 1));
}

/** Diagnose all root causes from a correlation set. */
export function diagnoseRootCauses(correlations: CorrelatedEvidence[]): RootCause[] {
  return evaluateRules(ROOT_CAUSE_RULES, correlations);
}

/** Diagnose only the root causes a given decision engine consumes (Phase 5). */
export function diagnoseForConsumer(consumer: string, correlations: CorrelatedEvidence[]): RootCause[] {
  return evaluateRules(rootCauseRulesForConsumer(consumer), correlations);
}

export interface RootCauseSummary {
  primary: number;
  blocking: number;
  contributing: number;
  resolved: number;
  conflicting: number;
  missing: number;
  /** The diagnosed cause titles, most significant first (excludes resolved/missing/conflicting). */
  diagnoses: Array<{ causeId: string; title: string; causeType: string; severity: number; confidence: number; reasonCode: string }>;
  reasonCodes: string[];
}

export function summarizeRootCauses(causes: RootCause[]): RootCauseSummary {
  const count = (t: string) => causes.filter((c) => c.causeType === t).length;
  const actionable = causes.filter((c) => c.causeType === 'blocking_cause' || c.causeType === 'primary_cause' || c.causeType === 'contributing_cause');
  return {
    primary: count('primary_cause'), blocking: count('blocking_cause'), contributing: count('contributing_cause'),
    resolved: count('resolved_cause'), conflicting: count('conflicting_cause'), missing: count('missing_cause'),
    diagnoses: actionable.map((c) => ({ causeId: c.causeId, title: c.title, causeType: c.causeType, severity: c.severity, confidence: c.confidence, reasonCode: c.reasonCodes[0] })),
    reasonCodes: causes.flatMap((c) => c.reasonCodes),
  };
}
