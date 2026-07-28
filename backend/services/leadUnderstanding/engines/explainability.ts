/**
 * LI-D306 — Lead Explainability Framework (deterministic; operates on a built Understanding).
 * For any conclusion, answers: Why? Why now? Which evidence? Which signals? Which assumptions? Which
 * contradictions? What changed? What confidence? What uncertainty? No opaque recommendations — every
 * field is derived from the canonical reasoning traces + evidence (nothing invented).
 */

import type { LeadUnderstanding, EvidenceRef, ContradictionRef } from '../types';
import { clamp01 } from './engineTypes';

export interface Explanation {
  claim: string;
  conclusion: string | number | boolean | null;
  why: string[];              // the claim + its assumptions
  whyNow: string | null;      // freshness of the driving evidence
  evidence: EvidenceRef[];
  signals: string[];          // evidence labels
  assumptions: string[];
  contradictions: ContradictionRef[];
  whatChanged: string[];      // vs a prior understanding (if supplied)
  confidence: number;
  uncertainty: number;
}

/** Explain a specific reasoning claim (default: the next-best-action recommendation). */
export function explain(u: LeadUnderstanding, claim = 'next_best_action', prior?: LeadUnderstanding): Explanation {
  const trace = u.reasoning.find((t) => t.claim === claim) ?? u.reasoning[0];
  const evidence = trace?.because ?? [];
  const contradictions = u.contradictions.filter((c) => evidence.some((e) => e.id === c.a || e.id === c.b));

  const whatChanged: string[] = [];
  if (prior) {
    for (const d of Object.keys(u.score.dimensions) as Array<keyof typeof u.score.dimensions>) {
      const now = u.score.dimensions[d].value, was = prior.score.dimensions[d].value;
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

/** Explain every reasoning claim on the Understanding (full transparency). */
export function explainAll(u: LeadUnderstanding, prior?: LeadUnderstanding): Explanation[] {
  return u.reasoning.map((t) => explain(u, t.claim, prior));
}
