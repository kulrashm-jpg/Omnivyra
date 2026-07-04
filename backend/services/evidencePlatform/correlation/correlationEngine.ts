/**
 * Canonical Cross-Evidence Correlation Engine  (BETA-ENGINE-009, Phase 2)
 *
 * ONE reusable engine that turns independent canonical Evidence into deterministic Correlated Evidence. It
 * resolves each rule's logical measurements from the physical evidence keys (provider-agnostic), evaluates
 * the rule, and produces an explainable `CorrelatedEvidence` result. When a required measurement is absent
 * it emits `missing_supporting_evidence` (never fabricates the relationship). NO AI, NO probability — pure.
 *
 * Only MEASURED, non-UNAVAILABLE numeric evidence participates (governance from BETA-ENGINE-008 has already
 * removed invalid rows before this point).
 */
import type { Evidence } from '../evidenceModel';
import type { CorrelatedEvidence, CorrelationMeasurement } from './correlationModel';
import { CORRELATION_RULES, MEASUREMENT_ALIASES, rulesForConsumer, type CorrelationRule } from './correlationRuleRegistry';

const keyOf = (e: Evidence): string => e.id?.split(':').pop() ?? '';
const round = (n: number): number => Math.round(n * 10000) / 10000;

interface MeasurementHit { key: string; value: number; observedAt: string | null }

/** Build a logical-measurement → hit map from a measured Evidence[] (first alias present wins). */
function resolveMeasurements(evidence: Evidence[]): Map<string, MeasurementHit> {
  const byKey = new Map<string, MeasurementHit>();
  for (const e of evidence) {
    if (e.maturity === 'UNAVAILABLE' || typeof e.value !== 'number') continue;
    const k = keyOf(e);
    if (k && !byKey.has(k)) byKey.set(k, { key: k, value: e.value, observedAt: e.observedAt ?? null });
  }
  const logical = new Map<string, MeasurementHit>();
  for (const [measurement, aliases] of Object.entries(MEASUREMENT_ALIASES)) {
    for (const alias of aliases) {
      const hit = byKey.get(alias);
      if (hit) { logical.set(measurement, hit); break; }
    }
  }
  return logical;
}

function evaluateRule(rule: CorrelationRule, logical: Map<string, MeasurementHit>): CorrelatedEvidence {
  const participating: CorrelationMeasurement[] = rule.participatingMeasurements.map((m) => {
    const hit = logical.get(m);
    return { measurement: m, key: hit?.key ?? null, value: hit?.value ?? null };
  });
  const present = rule.requiredMeasurements.filter((m) => logical.has(m));
  const missing = rule.requiredMeasurements.filter((m) => !logical.has(m));
  const coverage = rule.requiredMeasurements.length > 0 ? present.length / rule.requiredMeasurements.length : 0;

  // Freshest participating observation.
  const times = participating.map((p) => logical.get(p.measurement)?.observedAt).filter((t): t is string => !!t);
  const freshnessAt = times.length ? times.sort().slice(-1)[0] : null;

  // Missing supporting evidence → never assert the relationship.
  if (missing.length > 0) {
    return {
      ruleId: rule.id, relationshipType: 'missing_supporting_evidence', strength: 0, coverage: round(coverage),
      confidence: 0, explanation: `Cannot evaluate '${rule.id}': missing ${missing.join(', ')}.`,
      reasonCode: 'CORR_MISSING_SUPPORTING_EVIDENCE', participatingEvidence: participating,
      supportingMeasurements: present, missingMeasurements: missing, contradictions: [], dependencies: [],
      confidenceEffect: 'neutral', decisionConsumers: rule.decisionConsumers, freshnessAt, validationStatus: 'validated',
    };
  }

  const vals: Record<string, number> = {};
  for (const m of rule.participatingMeasurements) { const h = logical.get(m); if (h) vals[m] = h.value; }
  const outcome = rule.evaluate(vals);
  const asserted = outcome.relationshipType !== 'agreement' || outcome.strength > 0;
  return {
    ruleId: rule.id, relationshipType: outcome.relationshipType, strength: round(outcome.strength),
    coverage: round(coverage), confidence: round(asserted ? coverage * outcome.strength : 0),
    explanation: outcome.explanation, reasonCode: outcome.reasonCode, participatingEvidence: participating,
    supportingMeasurements: outcome.supporting, missingMeasurements: [], contradictions: outcome.contradictions,
    dependencies: outcome.dependencies, confidenceEffect: rule.confidenceEffect,
    decisionConsumers: rule.decisionConsumers, freshnessAt, validationStatus: 'validated',
  };
}

/** Correlate a canonical Evidence set against all registered rules. Deterministic + explainable. */
export function correlateEvidence(evidence: Evidence[]): CorrelatedEvidence[] {
  const logical = resolveMeasurements(evidence);
  return CORRELATION_RULES.map((rule) => evaluateRule(rule, logical));
}

/** Correlate only the rules a given decision engine consumes (Phase 5). */
export function correlateForConsumer(consumer: string, evidence: Evidence[]): CorrelatedEvidence[] {
  const logical = resolveMeasurements(evidence);
  return rulesForConsumer(consumer).map((rule) => evaluateRule(rule, logical));
}

/** A deterministic correlation summary a decision engine folds into its confidence (Phase 5). */
export interface CorrelationSummary {
  reinforcements: number; // reinforcement / strong_support asserted
  contradictions: number; // contradiction / conflicting_supporting_evidence asserted
  dependencies: number; // dependency asserted
  missing: number; // required corroboration absent
  evaluated: number; // rules that produced an asserted (non-neutral) relationship
  reasonCodes: string[];
}

/**
 * A bounded, deterministic coverage adjustment a decision engine folds into its evidence-aware confidence
 * (Phase 5). Reinforcing correlations raise coverage; contradictions + limiting dependencies lower it.
 * Bounded to [-0.15, 0.15] so correlation NEVER redesigns scoring — it only nudges the existing coverage
 * factor by measured, corroborating evidence. 0 when there are no asserted correlations.
 */
export function correlationCoverageDelta(summary: CorrelationSummary): number {
  const raw = 0.05 * summary.reinforcements - 0.05 * (summary.contradictions + summary.dependencies);
  return Math.max(-0.15, Math.min(0.15, Math.round(raw * 10000) / 10000));
}

export function summarizeCorrelations(correlations: CorrelatedEvidence[]): CorrelationSummary {
  const asserted = correlations.filter((c) => c.confidence > 0 || c.relationshipType === 'missing_supporting_evidence');
  const isReinforce = (t: string) => t === 'reinforcement' || t === 'strong_support';
  const isContradict = (t: string) => t === 'contradiction' || t === 'conflicting_supporting_evidence';
  return {
    reinforcements: correlations.filter((c) => c.confidence > 0 && isReinforce(c.relationshipType)).length,
    contradictions: correlations.filter((c) => c.confidence > 0 && isContradict(c.relationshipType)).length,
    dependencies: correlations.filter((c) => c.confidence > 0 && c.relationshipType === 'dependency').length,
    missing: correlations.filter((c) => c.relationshipType === 'missing_supporting_evidence').length,
    evaluated: correlations.filter((c) => c.confidence > 0).length,
    reasonCodes: asserted.map((c) => c.reasonCode),
  };
}
