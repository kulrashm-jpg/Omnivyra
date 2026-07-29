/**
 * Canonical Intent Projection — the SINGLE projection owner. Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { IntentUnderstanding, IntentProjection, IntentFacetName, IntentScoreDimension, IntentObjective, IntentIdentityValue } from './types';
import { INTENT_FACET_NAMES, INTENT_SCORE_DIMENSIONS } from './types';

export function projectIntent(u: IntentUnderstanding, projectedAt: string): IntentProjection {
  const scores = {} as Record<IntentScoreDimension, number | null>;
  for (const d of INTENT_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<IntentFacetName, number>;
  for (const name of INTENT_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);
  const conf = u.facets.confidence.value;
  const primaryObjective = (u.facets.primaryIntent.value?.objective ?? null) as IntentObjective | null;
  const competingObjectives = (u.facets.competingIntents.value?.candidates ?? [])
    .map((c) => c.objective)
    .filter((o) => o !== primaryObjective);

  return {
    key: u.key,
    version: u.version,
    identity: u.facets.identity.value as IntentIdentityValue | null,
    primaryObjective,
    competingObjectives,
    abstained: conf?.abstained ?? primaryObjective === null,
    scores,
    overallScore: u.score.overall,
    confidence: conf?.confidence ?? u.score.confidence,
    uncertainty: conf?.uncertainty ?? 1,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
