/**
 * Canonical Company Projection — the SINGLE projection owner (adopts the ontology `projectCompany
 * Fields` / FIELD_OWNERS design: one owner per projected field). Pure derived reshape — reads decided
 * facet/score values, never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type { CompanyUnderstanding, CompanyProjection, CompanyFacetName, CompanyScoreDimension, CompanyWorldView, IdentityValue } from './types';
import { COMPANY_FACET_NAMES, COMPANY_SCORE_DIMENSIONS } from './types';

export function projectCompany(u: CompanyUnderstanding, projectedAt: string): CompanyProjection {
  const scores = {} as Record<CompanyScoreDimension, number | null>;
  for (const d of COMPANY_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<CompanyFacetName, number>;
  for (const name of COMPANY_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);

  return {
    key: u.key,
    version: u.version,
    worldView: u.facets.worldView.value as CompanyWorldView | null,
    identity: u.facets.identity.value as IdentityValue | null,
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
