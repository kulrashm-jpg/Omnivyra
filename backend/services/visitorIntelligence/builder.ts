/**
 * Canonical Visitor Understanding builder — THE single owner (mirrors Program 1/2/3 builders).
 * Deterministic (`builtAt` passed in). Reuses the shared facet/scoring/contradiction/graph primitives
 * — no forked logic. Projects only from evidence; never fabricates.
 */

import type { VisitorUnderstanding, VisitorFacets, VisitorIdentityKey, VisitorContribution, EvidenceRef, EvidenceSummaryValue } from './types';
import { VISITOR_FACET_NAMES, VISITOR_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const VISITOR_MODEL_VERSION = 1;

export interface BuildVisitorInput {
  key: VisitorIdentityKey;
  builtAt: string;
  facets?: Partial<VisitorFacets>;
  evidence?: EvidenceRef[];
  contributions?: VisitorContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
}

function emptyFacets(): VisitorFacets {
  const f = {} as VisitorFacets;
  for (const name of VISITOR_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of VisitorUnderstanding. */
export function buildVisitorUnderstanding(input: BuildVisitorInput): VisitorUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: VisitorFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(VISITOR_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('visitor', input.key.visitorId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: VISITOR_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
