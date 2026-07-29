/**
 * Canonical Intent Understanding builder — THE single owner (mirrors Program 1/2/3/5/6 builders).
 * Deterministic (`builtAt` passed in). Reuses the shared facet/scoring/contradiction/graph primitives
 * — no forked logic. Projects only from evidence; never fabricates. The interpretation (primary +
 * competing intents + confidence) is derived upstream in `intentFromEvidence`, not here.
 */

import type { IntentUnderstanding, IntentFacets, IntentIdentityKey, IntentContribution, EvidenceRef, EvidenceSummaryValue } from './types';
import { INTENT_FACET_NAMES, INTENT_SCORE_DIMENSIONS } from './types';
import { facet, nullFacet, normalizeEvidence, detectEvidenceContradictions, node, buildEntityGraph, combineScoresFor } from '../intelligence/canonical';
import type { ReasoningTrace, GraphEdge } from '../intelligence/canonical';

export const INTENT_MODEL_VERSION = 1;

export interface BuildIntentInput {
  key: IntentIdentityKey;
  builtAt: string;
  facets?: Partial<IntentFacets>;
  evidence?: EvidenceRef[];
  contributions?: IntentContribution[];
  reasoning?: ReasoningTrace[];
  edges?: GraphEdge[];
}

function emptyFacets(): IntentFacets {
  const f = {} as IntentFacets;
  for (const name of INTENT_FACET_NAMES) (f as any)[name] = nullFacet();
  return f;
}

/** THE single producer of IntentUnderstanding. */
export function buildIntentUnderstanding(input: BuildIntentInput): IntentUnderstanding {
  const evidence = normalizeEvidence(input.evidence ?? []);
  const contributions = input.contributions ?? [];
  const facets: IntentFacets = { ...emptyFacets(), ...(input.facets ?? {}) };

  if (evidence.length) {
    const summary: EvidenceSummaryValue = { totalEvidence: evidence.length, freshestAt: evidence[0]?.observedAt };
    facets.evidenceSummary = facet(summary, evidence);
  }

  const score = combineScoresFor(INTENT_SCORE_DIMENSIONS, contributions);
  const contradictions = detectEvidenceContradictions(evidence).sort((a, b) => a.id.localeCompare(b.id));
  const graph = buildEntityGraph(node('intent', input.key.intentId), input.edges ?? []);

  return {
    key: input.key,
    facets,
    score,
    reasoning: input.reasoning ?? [],
    contradictions,
    graph,
    version: INTENT_MODEL_VERSION,
    builtAt: input.builtAt,
  };
}
