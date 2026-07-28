/**
 * Canonical Qualification Projection — the SINGLE projection owner. Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { QualificationUnderstanding, QualificationProjection, QualificationFacetName, QualificationScoreDimension, QualificationStatus, QualificationIdentityValue } from './types';
import { QUALIFICATION_FACET_NAMES, QUALIFICATION_SCORE_DIMENSIONS } from './types';

export function projectQualification(u: QualificationUnderstanding, projectedAt: string): QualificationProjection {
  const scores = {} as Record<QualificationScoreDimension, number | null>;
  for (const d of QUALIFICATION_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<QualificationFacetName, number>;
  for (const name of QUALIFICATION_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);
  const conf = u.facets.confidence.value;
  const evalv = u.facets.evaluation.value;
  const status = (u.facets.state.value?.status ?? null) as QualificationStatus | null;

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as QualificationIdentityValue | null,
    status,
    policyVersion: u.facets.policy.value?.policyVersion ?? null,
    satisfied: evalv?.satisfied ?? [],
    unsatisfied: evalv?.unsatisfied ?? [],
    unknown: evalv?.unknown ?? [],
    abstained: conf?.abstained ?? status === null,
    scores,
    overallScore: u.score.overall,
    confidence: conf?.confidence ?? u.score.confidence,
    uncertainty: conf?.uncertainty ?? 1,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
