/**
 * Canonical Journey Understanding builder — THE single owner (mirrors Program 1/2/3/5 builders).
 * Deterministic (`builtAt` passed in). Reuses the shared facet/scoring/contradiction/graph primitives
 * — no forked logic. Projects only from evidence; never fabricates. Ordering is derived upstream (in
 * `journeyFromRaw`) from evidence chronology, not here and not from the graph.
 */

import type { JourneyUnderstanding, JourneyFacets, JourneyIdentityKey, JourneyContribution, EvidenceRef, EvidenceSummaryValue } from './types';
import { JOURNEY_FACET_NAMES, JOURNEY_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const JOURNEY_MODEL_VERSION = 1;

export interface BuildJourneyInput {
  key: JourneyIdentityKey;
  builtAt: string;
  facets?: Partial<JourneyFacets>;
  evidence?: EvidenceRef[];
  contributions?: JourneyContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
}

function emptyFacets(): JourneyFacets {
  const f = {} as JourneyFacets;
  for (const name of JOURNEY_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of JourneyUnderstanding. */
export function buildJourneyUnderstanding(input: BuildJourneyInput): JourneyUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: JourneyFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(JOURNEY_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('journey', input.key.journeyId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: JOURNEY_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
