/**
 * QUALIFICATION-INTELLIGENCE-PROGRAM-008 / Phase C — qualification engine contract.
 * Every engine is a PURE, DETERMINISTIC evidence contributor that ANALYZES the Phase-B canonical
 * evaluation (it never re-derives the qualification state — it reuses `qualificationFromPolicy` for the
 * baseline and adds depth). An engine emits evidence / contributions / facet fragments / reasoning — it
 * NEVER owns Qualification Understanding, the projection, the score, the graph, or persistence (the
 * assembly pipeline is the sole owner). Engines abstain when evidence is insufficient. DESCRIPTIVE only
 * — no prediction, no recommendation, no workflow, no decisioning. The policy is IMMUTABLE input.
 * Chronology derives from evidence (`observedAt`).
 */

import type { QualificationIdentityKey, QualificationFacets, QualificationContribution, EvidenceRef } from '../types';
import type { ReasoningTrace } from '../../intelligence/canonical';
import type { QualificationEvaluationInput, AdoptedQualification } from '../fromPolicy';
import { qualificationFromPolicy } from '../fromPolicy';

export interface QualificationIntelligenceContext {
  key: QualificationIdentityKey;
  asOf: string;
  raw?: QualificationEvaluationInput;              // Phase-B evaluation input (policy + observations)
  upstream?: { visitorRef?: string; journeyRef?: string; intentRef?: string; leadRef?: string; companyRef?: string; offeringRef?: string };
}

export interface QualificationEngineOutput {
  engine: string;
  abstained: boolean;
  facets: Partial<QualificationFacets>;
  contributions: QualificationContribution[];
  evidence: EvidenceRef[];
  reasoning: ReasoningTrace[];
}

export function emptyOutput(engine: string): QualificationEngineOutput {
  return { engine, abstained: true, facets: {}, contributions: [], evidence: [], reasoning: [] };
}

/** The Phase-B baseline evaluation — REUSES `qualificationFromPolicy` (no re-derivation of state). */
export function baselineOf(ctx: QualificationIntelligenceContext): AdoptedQualification | null {
  if (!ctx.raw) return null;
  return qualificationFromPolicy(ctx.raw);
}
