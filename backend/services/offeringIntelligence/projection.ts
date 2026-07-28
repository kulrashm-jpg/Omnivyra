/**
 * Canonical Offering Projection — the SINGLE projection owner. Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { OfferingUnderstanding, OfferingProjection, OfferingFacetName, OfferingScoreDimension, OfferingType, IdentityValue } from './types';
import { OFFERING_FACET_NAMES, OFFERING_SCORE_DIMENSIONS } from './types';

export function projectOffering(u: OfferingUnderstanding, projectedAt: string): OfferingProjection {
  const scores = {} as Record<OfferingScoreDimension, number | null>;
  for (const d of OFFERING_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<OfferingFacetName, number>;
  for (const name of OFFERING_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as IdentityValue | null,
    offeringType: u.facets.offeringType.value as OfferingType | null,
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
