/**
 * Q-C307 — Qualification Health Summary (deterministic; descriptive). Combines evaluation quality +
 * evidence quality + confidence + policy completeness + uncertainty + context into one canonical
 * descriptive summary. Reads the decided facets/score — it owns no new scoring system, makes no
 * recommendation, progresses no workflow, and predicts nothing.
 */

import type { QualificationUnderstanding } from '../types';
import { clamp01 } from '../../intelligence/canonical';

export interface QualificationHealthSummary {
  status: string | null;
  abstained: boolean;
  fit: number | null;
  readiness: number | null;
  completeness: number | null;
  confidence: number;
  uncertainty: number;
  satisfiedCount: number;
  unsatisfiedCount: number;
  unknownCount: number;
  policyVersion: number | null;
  signals: string[];
}

export function qualificationHealthSummary(u: QualificationUnderstanding): QualificationHealthSummary {
  const d = u.score.dimensions;
  const conf = u.facets.confidence.value;
  const evalv = u.facets.evaluation.value;
  const status = u.facets.state.value?.status ?? null;

  const signals: string[] = [];
  if (status) signals.push(`state:${status}`);
  if (u.facets.policy.value?.policyId) signals.push(`policy:${u.facets.policy.value.policyId}@v${u.facets.policy.value.policyVersion}`);
  if (evalv?.unknown?.length) signals.push(`unknown:${evalv.unknown.length}`);

  return {
    status,
    abstained: conf?.abstained ?? status === null,
    fit: d.fit.value,
    readiness: d.readiness.value,
    completeness: d.completeness.value,
    confidence: clamp01(conf?.confidence ?? u.score.confidence),
    uncertainty: clamp01(conf?.uncertainty ?? 1),
    satisfiedCount: evalv?.satisfied?.length ?? 0,
    unsatisfiedCount: evalv?.unsatisfied?.length ?? 0,
    unknownCount: evalv?.unknown?.length ?? 0,
    policyVersion: u.facets.policy.value?.policyVersion ?? null,
    signals,
  };
}
