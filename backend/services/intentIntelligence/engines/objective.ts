/**
 * I-C301 — Objective Intelligence Engine (deterministic contributor). Analyzes the Phase-B primary
 * intent: objective strength, stability, competing-objective balance, abstention conditions. Evidence-
 * backed; does NOT re-derive the objective (reuses the baseline). Abstains when the baseline abstains.
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runObjective(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const base = baselineOf(ctx);
  const primary = base?.facets.primaryIntent?.value?.objective;
  const candidates = base?.facets.competingIntents?.value?.candidates ?? [];
  if (!base || !primary || !candidates.length) return emptyOutput('objective');
  const src = ctx.raw?.source ?? 'intent_capture', at = ctx.asOf;

  const c0 = candidates[0]?.confidence ?? 0;
  const c1 = candidates[1]?.confidence ?? 0;
  const strength = clamp01(c0);
  // clarity = separation between the leading objective and the runner-up (bigger gap ⇒ clearer).
  const clarity = candidates.length > 1 ? clamp01((c0 - c1) / Math.max(c0, 1e-6)) : 1;

  const ev: EvidenceRef[] = [
    mkEvidence('objective', { label: 'primary', value: primary, source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('objective', { label: 'balance', value: Number((c0 - c1).toFixed(4)), source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: IntentEngineOutput = { ...emptyOutput('objective'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'strength', contributor: 'objective', method: 'deterministic', value: strength, confidence: clamp01(0.4 + 0.1 * Math.min(candidates.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'clarity', contributor: 'objective', method: 'deterministic', value: clarity, confidence: clamp01(0.4 + 0.1 * Math.min(candidates.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'objective_strength', conclusion: primary, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`strength=${strength}, clarity=${clarity}, competing=${candidates.length - 1}`], unknowns: [] }));
  return o;
}
