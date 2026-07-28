/**
 * Canonical Visitor Projection — the SINGLE projection owner. Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { VisitorUnderstanding, VisitorProjection, VisitorFacetName, VisitorScoreDimension, VisitorStatus, VisitorLifecycleState, VisitorIdentityValue } from './types';
import { VISITOR_FACET_NAMES, VISITOR_SCORE_DIMENSIONS } from './types';

export function projectVisitor(u: VisitorUnderstanding, projectedAt: string): VisitorProjection {
  const scores = {} as Record<VisitorScoreDimension, number | null>;
  for (const d of VISITOR_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<VisitorFacetName, number>;
  for (const name of VISITOR_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as VisitorIdentityValue | null,
    status: (u.facets.identity.value?.status ?? null) as VisitorStatus | null,
    lifecycle: (u.facets.lifecycle.value?.state ?? null) as VisitorLifecycleState | null,
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
