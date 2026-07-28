/**
 * OI-B210 — Offering Understanding observability (pure summarizer; no global state, no live telemetry
 * emission — keeps Phase B additive). Summarizes builder/facet generation, evidence, contradictions,
 * score generation, graph, reasoning, and shadow divergence.
 */

import type { OfferingUnderstanding } from './types';
import type { OfferingShadowComparison } from './shadowRuntime';
import { OFFERING_FACET_NAMES, OFFERING_SCORE_DIMENSIONS } from './types';

export interface OfferingRunSummary {
  offerings: number;
  facetsGenerated: number;
  facetAbstentions: number;
  evidence: number;
  contradictions: number;
  unresolvedContradictions: number;
  scoredDimensions: number;
  graphEdges: number;
  reasoningTraces: number;
  shadow: { compared: number; meanParity: number; divergent: number };
}

export function summarizeOfferingRun(understandings: OfferingUnderstanding[], comparisons: OfferingShadowComparison[] = []): OfferingRunSummary {
  let facetsGenerated = 0, facetAbstentions = 0, evidence = 0, contradictions = 0, unresolved = 0, graphEdges = 0, reasoningTraces = 0, scoredDimensions = 0;
  for (const u of understandings) {
    for (const name of OFFERING_FACET_NAMES) { const f = u.facets[name]; if (f.value === null) facetAbstentions++; else facetsGenerated++; evidence += f.evidence.length; }
    for (const d of OFFERING_SCORE_DIMENSIONS) if (!u.score.dimensions[d].abstained) scoredDimensions++;
    contradictions += u.contradictions.length;
    unresolved += u.contradictions.filter((c) => !c.resolved).length;
    graphEdges += u.graph.edges.length;
    reasoningTraces += u.reasoning.length;
  }
  const meanParity = comparisons.length ? Number((comparisons.reduce((a, c) => a + c.parity, 0) / comparisons.length).toFixed(4)) : 1;
  return {
    offerings: understandings.length,
    facetsGenerated, facetAbstentions, evidence, contradictions, unresolvedContradictions: unresolved,
    scoredDimensions, graphEdges, reasoningTraces,
    shadow: { compared: comparisons.length, meanParity, divergent: comparisons.filter((c) => c.parity < 1).length },
  };
}
