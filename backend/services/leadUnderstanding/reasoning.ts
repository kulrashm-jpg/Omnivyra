/**
 * LI-B104 — Canonical Reasoning contract (pure). ONE reasoning interface: every reasoning engine
 * returns a `ReasoningTrace` answering why / based-on-what / how-confident / what-contradicts /
 * what-is-unknown / what-is-assumed / freshness / provenance. NO opaque outputs: a non-null
 * conclusion with no supporting evidence is INVALID (must abstain with an unknown instead).
 */

import type { ReasoningTrace, EvidenceRef, ContradictionRef, ReasoningMethod, ISOTimestamp } from './types';

function provenanceOf(evidence: EvidenceRef[]) {
  const seen = new Set<string>();
  return evidence
    .map((e) => e.source)
    .filter((s) => { const k = `${s.system}|${s.ref ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.system.localeCompare(b.system));
}
function freshest(evidence: EvidenceRef[]): ISOTimestamp | null {
  return evidence.length ? evidence.reduce((m, e) => (e.observedAt > m ? e.observedAt : m), evidence[0].observedAt) : null;
}

export function reasoningTrace(input: {
  claim: string; conclusion: string | number | boolean | null; because: EvidenceRef[];
  confidence: number; method: ReasoningMethod;
  contradictions?: ContradictionRef[]; unknowns?: string[]; assumptions?: string[];
}): ReasoningTrace {
  return {
    claim: input.claim,
    conclusion: input.conclusion,
    because: [...input.because],
    confidence: Math.max(0, Math.min(1, input.confidence)),
    contradictions: input.contradictions ?? [],
    unknowns: input.unknowns ?? [],
    assumptions: input.assumptions ?? [],
    freshness: freshest(input.because),
    provenance: provenanceOf(input.because),
    method: input.method,
  };
}

/** Grounded = a concluded (non-null) claim cites at least one evidence item. */
export function isGrounded(t: ReasoningTrace): boolean {
  return t.conclusion === null ? true : t.because.length > 0;
}

/** Valid iff grounded AND (if it abstains, it explains why via an unknown). No opaque outputs. */
export function validateReasoning(t: ReasoningTrace): { valid: boolean; reason?: string } {
  if (!isGrounded(t)) return { valid: false, reason: 'ungrounded_conclusion' };
  if (t.conclusion === null && t.unknowns.length === 0) return { valid: false, reason: 'abstained_without_unknown' };
  if (t.confidence < 0 || t.confidence > 1) return { valid: false, reason: 'confidence_out_of_range' };
  return { valid: true };
}
