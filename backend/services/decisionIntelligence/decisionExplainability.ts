/**
 * decisionExplainability.ts — decision explainability (PMF-007R §4).
 *
 * Every Decision Object exposes why / why now / why this priority / what evidence /
 * what dependencies / what confidence factors. No opaque decisions. Pure/deterministic
 * — derived from the Decision Object; additive (never mutates the decision).
 */

import type { DecisionObject } from './decisionObjectModel';

export interface DecisionExplanation {
  why: string;
  whyNow: string;
  whyThisPriority: string;
  whatEvidence: string[];
  whatDependencies: string[];
  whatConfidenceFactors: string[];
}

function confidenceFactors(d: DecisionObject): string[] {
  const factors: string[] = [];
  factors.push(`base confidence ${d.confidence}`);
  factors.push(d.evidence.length ? `${d.evidence.length} evidence source(s): ${d.evidence.join(', ')}` : 'no evidence sources');
  factors.push(d.knowledgeVersion != null ? `knowledge version v${d.knowledgeVersion}` : 'live knowledge (no version)');
  if (d.dependencies.length) factors.push(`${d.dependencies.length} upstream dependency(ies)`);
  return factors;
}

/** Build the decision explanation. Deterministic. */
export function explainDecision(d: DecisionObject): DecisionExplanation {
  return {
    why: `${d.title}: ${d.summary} → ${d.recommendedAction}. Reason codes: ${d.reasonCodes.join(', ') || 'none'}.`,
    whyNow: `Urgency ${d.urgency}; business impact ${d.businessImpact}. ${d.urgency === 'immediate' || d.urgency === 'high' ? 'Act now to avoid opportunity cost.' : 'Schedule within the current cycle.'}`,
    whyThisPriority: `priority=${d.priority} (${d.businessImpact} impact, ${d.effort} effort, ${d.risk} risk): higher-impact / lower-effort decisions rank first.`,
    whatEvidence: [...d.evidence],
    whatDependencies: [...d.dependencies],
    whatConfidenceFactors: confidenceFactors(d),
  };
}

/** Attach the explanation additively (reserved key; never mutates the decision). */
export function withDecisionExplanation(d: DecisionObject): DecisionObject & { explanation: DecisionExplanation } {
  return { ...d, explanation: explainDecision(d) };
}
