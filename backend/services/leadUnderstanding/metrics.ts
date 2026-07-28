/**
 * LI-B110 — Observability (pure summarizer; no global state, no live telemetry emission).
 * Summarizes a shadow run: facet generation, evidence lifecycle, contradiction detection, score
 * generation, projection, graph, and shadow divergence. Wiring to live dashboards/telemetry is a
 * later (rollout) phase — this keeps Phase B 100% additive (no telemetry-registry change).
 */

import type { LeadUnderstanding, ShadowComparison, EvidenceLifecycle, ScoreDimension } from './types';
import { LEAD_FACET_NAMES, SCORE_DIMENSIONS } from './types';

export interface LeadUnderstandingRunSummary {
  leads: number;
  facetsGenerated: number;                        // non-abstaining facets across all leads
  facetAbstentions: number;
  evidenceByLifecycle: Record<EvidenceLifecycle, number>;
  contradictions: number;
  unresolvedContradictions: number;
  scoredDimensions: Record<ScoreDimension, number>; // count of non-abstained per dimension
  graphEdges: number;
  reasoningTraces: number;
  shadow: { compared: number; meanParity: number; divergent: number };
}

export function summarizeLeadUnderstandingRun(understandings: LeadUnderstanding[], comparisons: ShadowComparison[] = []): LeadUnderstandingRunSummary {
  const evidenceByLifecycle: Record<EvidenceLifecycle, number> = { created: 0, refreshed: 0, superseded: 0, expired: 0 };
  const scoredDimensions = {} as Record<ScoreDimension, number>;
  for (const d of SCORE_DIMENSIONS) scoredDimensions[d] = 0;
  let facetsGenerated = 0, facetAbstentions = 0, contradictions = 0, unresolved = 0, graphEdges = 0, reasoningTraces = 0;

  for (const u of understandings) {
    for (const name of LEAD_FACET_NAMES) {
      const f = u.facets[name];
      if (f.value === null) facetAbstentions++; else facetsGenerated++;
      for (const e of f.evidence) evidenceByLifecycle[e.lifecycle]++;
    }
    for (const d of SCORE_DIMENSIONS) if (!u.score.dimensions[d].abstained) scoredDimensions[d]++;
    contradictions += u.contradictions.length;
    unresolved += u.contradictions.filter((c) => !c.resolved).length;
    graphEdges += u.graph.edges.length;
    reasoningTraces += u.reasoning.length;
  }

  const meanParity = comparisons.length ? Number((comparisons.reduce((a, c) => a + c.parity, 0) / comparisons.length).toFixed(4)) : 1;
  return {
    leads: understandings.length,
    facetsGenerated, facetAbstentions, evidenceByLifecycle,
    contradictions, unresolvedContradictions: unresolved,
    scoredDimensions, graphEdges, reasoningTraces,
    shadow: { compared: comparisons.length, meanParity, divergent: comparisons.filter((c) => c.parity < 1).length },
  };
}
