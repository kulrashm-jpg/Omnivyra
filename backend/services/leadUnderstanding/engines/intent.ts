/**
 * LI-C203 — Intent Intelligence (deterministic contributor).
 * Fuses first-party behaviour (website/content/campaign/email/social) into a decayed intent signal
 * with momentum (recent vs older window) and trend. Emits an `intent` score contribution + intent
 * facet. Abstains when no behaviour. Decay/momentum are deterministic (asOf passed in).
 */

import type { EngineOutput, LeadIntelligenceContext, RawObservation } from './engineTypes';
import { emptyOutput, mkEvidence, decayFactor, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, IntentValue } from '../types';

const ENGINE = 'intent';
const INTENT_HALFLIFE_DAYS = 21;
// High-intent behaviours weigh more (deterministic policy).
function behaviourWeight(label: string): number {
  const l = label.toLowerCase();
  if (/pricing|demo|contact|trial|quote/.test(l)) return 0.9;
  if (/case_?study|comparison|integration|docs/.test(l)) return 0.7;
  if (/webinar|guide|whitepaper|download/.test(l)) return 0.55;
  if (/blog|article|social/.test(l)) return 0.35;
  return 0.4;
}

export function runIntent(ctx: LeadIntelligenceContext): EngineOutput {
  const behaviour = ctx.behaviour ?? [];
  if (!behaviour.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const evidence: EvidenceRef[] = behaviour.map((o: RawObservation) =>
    mkEvidence(ENGINE, { ...o, weight: clamp01(behaviourWeight(o.label) * (o.weight ?? 1)) }));
  out.evidence = evidence;

  let num = 0, den = 0;
  for (const o of behaviour) {
    const w = behaviourWeight(o.label) * (o.weight ?? 1);
    num += w * decayFactor(o.observedAt, ctx.asOf, INTENT_HALFLIFE_DAYS); den += w;
  }
  const intent = den > 0 ? clamp01(num / den) : null;

  // Momentum: decayed weight in the fresh half vs the stale half of observations (by recency).
  const sorted = [...behaviour].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const recent = sorted.slice(0, half).reduce((a, o) => a + behaviourWeight(o.label), 0);
  const older = sorted.slice(half).reduce((a, o) => a + behaviourWeight(o.label), 0) || 0.0001;
  const momentum = clamp01(recent / (recent + older));
  const confidence = clamp01(0.4 + 0.15 * Math.min(behaviour.length, 4));

  if (intent !== null) {
    out.contributions.push({ dimension: 'intent', contributor: ENGINE, method: 'deterministic', value: intent, confidence, evidence, asOf: ctx.asOf });
  }
  const intentVal: IntentValue = { implicitSignals: behaviour.map((o) => o.label), aggregated: intent ?? 0, decayApplied: true };
  out.facets.intent = facet(intentVal, evidence);
  out.reasoning.push(reasoningTrace({ claim: 'first_party_intent', conclusion: intent, because: evidence, confidence, method: 'deterministic', assumptions: [`half-life ${INTENT_HALFLIFE_DAYS}d`, `momentum ${momentum}`], unknowns: [] }));
  return out;
}
