/**
 * Shared canonical EXPLAINABILITY — a generic explanation over any Understanding that exposes
 * reasoning traces + contradictions + scored dimensions (Lead/Company/Offering). Answers Why / Why
 * now / evidence / signals / assumptions / contradictions / what-changed / confidence / uncertainty.
 * No opaque conclusions — derived only from the canonical traces + evidence (nothing invented).
 */

import type { EvidenceRef, ContradictionRef, ReasoningTrace } from './contracts';
import { clamp01 } from './helpers';

export interface ExplainableUnderstanding {
  reasoning: ReasoningTrace[];
  contradictions: ContradictionRef[];
  score: { dimensions: Record<string, { value: number | null }> };
}

export interface Explanation {
  claim: string;
  conclusion: string | number | boolean | null;
  why: string[];
  whyNow: string | null;
  evidence: EvidenceRef[];
  signals: string[];
  assumptions: string[];
  contradictions: ContradictionRef[];
  whatChanged: string[];
  confidence: number;
  uncertainty: number;
}

export function explainUnderstanding(u: ExplainableUnderstanding, claim: string, prior?: ExplainableUnderstanding): Explanation {
  const trace = u.reasoning.find((t) => t.claim === claim) ?? u.reasoning[0];
  const evidence = trace?.because ?? [];
  const contradictions = u.contradictions.filter((c) => evidence.some((e) => e.id === c.a || e.id === c.b));

  const whatChanged: string[] = [];
  if (prior) {
    for (const d of Object.keys(u.score.dimensions)) {
      const now = u.score.dimensions[d]?.value ?? null;
      const was = prior.score.dimensions[d]?.value ?? null;
      if (now !== was) whatChanged.push(`${d}: ${was ?? 'abstain'} → ${now ?? 'abstain'}`);
    }
  }

  return {
    claim: trace?.claim ?? claim,
    conclusion: trace?.conclusion ?? null,
    why: [trace?.claim ?? claim, ...(trace?.assumptions ?? [])],
    whyNow: trace?.freshness ?? null,
    evidence,
    signals: [...new Set(evidence.map((e) => e.label))],
    assumptions: trace?.assumptions ?? [],
    contradictions,
    whatChanged,
    confidence: trace?.confidence ?? 0,
    uncertainty: clamp01(1 - (trace?.confidence ?? 0)),
  };
}

export function explainAll(u: ExplainableUnderstanding, prior?: ExplainableUnderstanding): Explanation[] {
  return u.reasoning.map((t) => explainUnderstanding(u, t.claim, prior));
}
