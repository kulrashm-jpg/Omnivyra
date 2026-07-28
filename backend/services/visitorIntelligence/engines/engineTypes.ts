/**
 * VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 / Phase B — visitor engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor into the Phase-A canonical Visitor
 * contracts. An engine emits evidence / contributions / facet fragments / reasoning — it NEVER owns
 * Visitor Understanding, the projection, the score, the graph, or persistence (the assembly pipeline
 * is the sole owner). Engines abstain when evidence is insufficient. Descriptive only — no prediction,
 * no intent, no journeys, no attribution.
 */

import type { VisitorIdentityKey, VisitorFacets, VisitorContribution, EvidenceRef } from '../types';
import type { ReasoningTrace, GraphEdge } from '../../intelligence/canonical';
import type { VisitorRawInput } from '../fromRaw';

/** One prior session observation (for session/activity enrichment). */
export interface VisitorSessionObservation { at: string; pages?: number; durationSeconds?: number; }

export interface VisitorIntelligenceContext {
  key: VisitorIdentityKey;
  asOf: string;
  raw?: VisitorRawInput;                              // Phase-A ingestion baseline (facets + edges)
  history?: { sessions?: VisitorSessionObservation[] }; // optional prior-visit history (descriptive)
}

export interface VisitorEngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<VisitorFacets>;
  contributions: VisitorContribution[];
  evidence: EvidenceRef[];
  edges: GraphEdge[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): VisitorEngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] };
}

/** Deterministic ordinal for qualitative levels (shared across engines). */
export const ord = (v?: string): number => {
  const s = (v ?? '').toLowerCase();
  if (/high|strong|rich|frequent|daily|growing|active/.test(s)) return 1;
  if (/medium|moderate|weekly|steady|stable/.test(s)) return 0.6;
  if (/low|weak|rare|monthly|declining|dormant/.test(s)) return 0.25;
  return 0.5;
};
