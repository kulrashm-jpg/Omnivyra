/**
 * Canonical Journey Projection — the SINGLE projection owner. Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { JourneyUnderstanding, JourneyProjection, JourneyFacetName, JourneyScoreDimension, JourneyStatus, JourneyIdentityValue } from './types';
import { JOURNEY_FACET_NAMES, JOURNEY_SCORE_DIMENSIONS } from './types';

export function projectJourney(u: JourneyUnderstanding, projectedAt: string): JourneyProjection {
  const scores = {} as Record<JourneyScoreDimension, number | null>;
  for (const d of JOURNEY_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<JourneyFacetName, number>;
  for (const name of JOURNEY_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as JourneyIdentityValue | null,
    status: (u.facets.state.value?.status ?? null) as JourneyStatus | null,
    currentStage: u.facets.stages.value?.current ?? null,
    touchpointCount: u.facets.touchpoints.value?.count ?? null,
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
