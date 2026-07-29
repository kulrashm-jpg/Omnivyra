/**
 * INTENT-INTELLIGENCE-PROGRAM-007 / Phase C — intent engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor that ANALYZES the Phase-B canonical
 * interpretation (it never re-derives the primary intent — it reuses `intentFromEvidence` for the
 * baseline and adds depth). An engine emits evidence / contributions / facet fragments / reasoning — it
 * NEVER owns Intent Understanding, the projection, the score, the graph, or persistence (the assembly
 * pipeline is the sole owner). Engines abstain when evidence is insufficient. DESCRIPTIVE only — no
 * prediction, no recommendation, no decisioning. Chronology derives from evidence (`observedAt`).
 */

import type { IntentIdentityKey, IntentFacets, IntentContribution, EvidenceRef } from '../types';
import type { ReasoningTrace } from '../../intelligence/canonical';
import type { IntentEvidenceInput, AdoptedIntent } from '../fromEvidence';
import { intentFromEvidence } from '../fromEvidence';

export interface IntentIntelligenceContext {
  key: IntentIdentityKey;
  asOf: string;
  raw?: IntentEvidenceInput;                       // Phase-B ingestion input (evidence signals)
  upstream?: { visitorRef?: string; journeyRef?: string; leadRef?: string; companyRef?: string; offeringRef?: string };
}

export interface IntentEngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<IntentFacets>;
  contributions: IntentContribution[];
  evidence: EvidenceRef[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): IntentEngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], reasoning: [] };
}

/** The Phase-B baseline interpretation — REUSES `intentFromEvidence` (no re-derivation of intent). */
export function baselineOf(ctx: IntentIntelligenceContext): AdoptedIntent | null {
  if (!ctx.raw) return null;
  return intentFromEvidence(ctx.raw);
}
