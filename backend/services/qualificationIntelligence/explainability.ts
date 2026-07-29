/**
 * Q-B207 — Qualification Explainability. Thin wrapper over the shared canonical `explainUnderstanding` —
 * every Qualification conclusion answers Why / policy version / evidence / chronology / assumptions /
 * contradictions / what-changed / confidence / uncertainty / abstention reason. No opaque conclusions;
 * reuses shared explainability (no qualification-specific explainer). Policy provenance is carried in
 * the reasoning trace assumptions.
 */

import type { QualificationUnderstanding } from './types';
import { explainUnderstanding, explainAll, type Explanation } from '../intelligence/canonical';

export function explainQualification(u: QualificationUnderstanding, claim: string, prior?: QualificationUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainQualificationAll(u: QualificationUnderstanding, prior?: QualificationUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
