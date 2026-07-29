/**
 * V-C (observability) — Visitor Understanding observability (pure summarizer; no global state, no live
 * telemetry emission — additive). Summarizes facet generation, evidence, contradictions, score
 * generation, graph, reasoning, and shadow divergence. Mirrors the Offering/Company metrics contract.
 */

import type { VisitorUnderstanding } from './types';
import type { VisitorShadowComparison } from './shadowRuntime';
import { VISITOR_FACET_NAMES, VISITOR_SCORE_DIMENSIONS } from './types';

export interface VisitorRunSummary {
  visitors: number;
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

export function summarizeVisitorRun(understandings: VisitorUnderstanding[], comparisons: VisitorShadowComparison[] = []): VisitorRunSummary {
  let facetsGenerated = 0, facetAbstentions = 0, evidence = 0, contradictions = 0, unresolved = 0, graphEdges = 0, reasoningTraces = 0, scoredDimensions = 0;
  for (const u of understandings) {
    for (const name of VISITOR_FACET_NAMES) { const f = u.facets[name]; if (f.value === null) facetAbstentions++; else facetsGenerated++; evidence += f.evidence.length; }
    for (const d of VISITOR_SCORE_DIMENSIONS) if (!u.score.dimensions[d].abstained) scoredDimensions++;
    contradictions += u.contradictions.length;
    unresolved += u.contradictions.filter((c) => !c.resolved).length;
    graphEdges += u.graph.edges.length;
    reasoningTraces += u.reasoning.length;
  }
  const meanParity = comparisons.length ? Number((comparisons.reduce((a, c) => a + c.parity, 0) / comparisons.length).toFixed(4)) : 1;
  return {
    visitors: understandings.length,
    facetsGenerated, facetAbstentions, evidence, contradictions, unresolvedContradictions: unresolved,
    scoredDimensions, graphEdges, reasoningTraces,
    shadow: { compared: comparisons.length, meanParity, divergent: comparisons.filter((c) => c.parity < 1).length },
  };
}
