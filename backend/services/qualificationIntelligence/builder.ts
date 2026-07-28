/**
 * Canonical Qualification Understanding builder — THE single owner (mirrors Program 1/2/3/5/6/7
 * builders). Deterministic (`builtAt` passed in). Reuses the shared facet/scoring/contradiction/graph
 * primitives — no forked logic. Projects only from evidence; never fabricates. The policy evaluation
 * (state + per-criterion outcome + confidence) is derived upstream in `qualificationFromPolicy`.
 */

import type { QualificationUnderstanding, QualificationFacets, QualificationIdentityKey, QualificationContribution, EvidenceRef, EvidenceSummaryValue } from './types';
import { QUALIFICATION_FACET_NAMES, QUALIFICATION_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const QUALIFICATION_MODEL_VERSION = 1;

export interface BuildQualificationInput {
  key: QualificationIdentityKey;
  builtAt: string;
  facets?: Partial<QualificationFacets>;
  evidence?: EvidenceRef[];
  contributions?: QualificationContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
}

function emptyFacets(): QualificationFacets {
  const f = {} as QualificationFacets;
  for (const name of QUALIFICATION_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of QualificationUnderstanding. */
export function buildQualificationUnderstanding(input: BuildQualificationInput): QualificationUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: QualificationFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(QUALIFICATION_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('qualification', input.key.qualificationId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: QUALIFICATION_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
