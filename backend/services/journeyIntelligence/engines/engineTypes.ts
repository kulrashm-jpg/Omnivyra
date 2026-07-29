/**
 * JOURNEY-INTELLIGENCE-PROGRAM-006 / Phase C — journey engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor into the Phase-B canonical Journey
 * contracts. An engine emits evidence / contributions / facet fragments / reasoning — it NEVER owns
 * Journey Understanding, the projection, the score, the graph, or persistence (the assembly pipeline
 * is the sole owner). Engines abstain when evidence is insufficient. DESCRIPTIVE only — no prediction,
 * no intent, no optimization, no recommendation. Chronology derives from evidence (`observedAt`).
 */

import type { JourneyIdentityKey, JourneyFacets, JourneyContribution, EvidenceRef } from '../types';
import type { ReasoningTrace, GraphEdge } from '../../intelligence/canonical';
import type { JourneyRawInput, JourneyRawTouchpoint } from '../fromRaw';

export interface JourneyIntelligenceContext {
  key: JourneyIdentityKey;
  asOf: string;
  raw?: JourneyRawInput;             // Phase-B ingestion baseline (ordering derives from its touchpoints)
}

export interface JourneyEngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<JourneyFacets>;
  contributions: JourneyContribution[];
  evidence: EvidenceRef[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): JourneyEngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], reasoning: [] };
}

/** DETERMINISTIC chronological ordering (observedAt, then stable input index) — the ONE order source. */
export function orderedTouchpoints(raw?: JourneyRawInput): JourneyRawTouchpoint[] {
  return [...(raw?.touchpoints ?? [])]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.observedAt === b.t.observedAt ? a.i - b.i : a.t.observedAt.localeCompare(b.t.observedAt)))
    .map(({ t }) => t);
}

/** Distinct-consecutive stage sequence in chronological order. */
export function stageSequence(tps: JourneyRawTouchpoint[]): string[] {
  const out: string[] = [];
  for (const t of tps) if (t.stage && out[out.length - 1] !== t.stage) out.push(t.stage);
  return out;
}

export const DAY = 86_400_000;
