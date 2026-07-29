/**
 * Canonical Offering Understanding builder — THE single owner (mirrors Program 1/2 builders).
 * Deterministic (`builtAt` passed in). Reuses the shared scoring + contradiction primitives — no
 * forked logic. Adopts the shadow design's "project from evidence, never fabricate" principle.
 */

import type { OfferingUnderstanding, OfferingFacets, OfferingIdentityKey, OfferingContribution, OfferingType, EvidenceRef, EvidenceSummaryValue } from './types';
import { OFFERING_FACET_NAMES, OFFERING_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const OFFERING_MODEL_VERSION = 1;

export interface BuildOfferingInput {
  key: OfferingIdentityKey;
  builtAt: string;
  facets?: Partial<OfferingFacets>;
  evidence?: EvidenceRef[];
  contributions?: OfferingContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
  offeringType?: OfferingType;
}

function emptyFacets(): OfferingFacets {
  const f = {} as OfferingFacets;
  for (const name of OFFERING_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of OfferingUnderstanding. */
export function buildOfferingUnderstanding(input: BuildOfferingInput): OfferingUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: OfferingFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (input.offeringType && evidence.length) facets.offeringType = facet(input.offeringType, evidence);
  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(OFFERING_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('offering', input.key.offeringId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: OFFERING_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
