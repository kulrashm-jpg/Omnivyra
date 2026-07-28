/**
 * LI-C202 — Buying Signal Intelligence (deterministic contributor).
 * Aggregates external buying signals (hiring/funding/exec-change/…) into evidence with freshness +
 * decay + source weighting, and emits `opportunity` + `urgency` score contributions. Abstains when
 * no signals. No independent buying score — contributions only.
 */

import type { EngineOutput, LeadIntelligenceContext, BuyingSignalType, RawSignal } from './engineTypes';
import { emptyOutput, mkEvidence, decayFactor, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, EvidenceKind, BuyingValue } from '../types';

const ENGINE = 'buying_signal';
// Signal strength (0..1) + half-life (days) — deterministic policy, not learned.
const SIGNAL_WEIGHT: Record<BuyingSignalType, number> = {
  funding: 0.9, exec_change: 0.75, leadership: 0.7, hiring: 0.65, expansion: 0.8, acquisition: 0.8,
  tech_migration: 0.75, tech_adoption: 0.6, product_launch: 0.55, pricing_change: 0.5, partnership: 0.55,
  customer_announcement: 0.5, analyst: 0.5, filing: 0.55, news: 0.4, website_change: 0.4, social: 0.35, community: 0.35,
};
const SIGNAL_HALFLIFE: Record<BuyingSignalType, number> = {
  funding: 180, acquisition: 180, exec_change: 120, leadership: 120, expansion: 120, hiring: 90, tech_migration: 120,
  tech_adoption: 90, product_launch: 60, pricing_change: 60, partnership: 90, customer_announcement: 60, analyst: 90,
  filing: 120, news: 30, website_change: 30, social: 14, community: 14,
};
const SIGNAL_KIND: Partial<Record<BuyingSignalType, EvidenceKind>> = { filing: 'structured', funding: 'external', analyst: 'external', news: 'external', social: 'observed', community: 'observed' };

export function runBuyingSignal(ctx: LeadIntelligenceContext): EngineOutput {
  const signals = ctx.signals ?? [];
  if (!signals.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const evidence: EvidenceRef[] = signals.map((s: RawSignal) =>
    mkEvidence(ENGINE, { label: `signal:${s.type}`, value: s.detail ?? s.type, source: s.source, observedAt: s.observedAt, kind: SIGNAL_KIND[s.type] ?? 'external', weight: clamp01((SIGNAL_WEIGHT[s.type] ?? 0.4) * (s.confidence ?? 1)) }));
  out.evidence = evidence;

  // Decayed, weighted aggregate → opportunity + urgency contributions.
  let oppNum = 0, oppDen = 0, freshest = 0;
  for (const s of signals) {
    const w = (SIGNAL_WEIGHT[s.type] ?? 0.4) * (s.confidence ?? 1);
    const decay = decayFactor(s.observedAt, ctx.asOf, SIGNAL_HALFLIFE[s.type] ?? 30);
    oppNum += w * decay; oppDen += w;
    freshest = Math.max(freshest, decay);
  }
  const opportunity = oppDen > 0 ? clamp01(oppNum / oppDen) : null;
  const confidence = clamp01(0.4 + 0.15 * Math.min(signals.length, 4));

  if (opportunity !== null) {
    out.contributions.push({ dimension: 'opportunity', contributor: ENGINE, method: 'deterministic', value: opportunity, confidence, evidence, asOf: ctx.asOf });
    out.contributions.push({ dimension: 'urgency', contributor: ENGINE, method: 'deterministic', value: clamp01(freshest * opportunity), confidence, evidence, asOf: ctx.asOf });
  }
  const buyingVal: BuyingValue = { initiatives: signals.map((s) => s.type), timing: freshest > 0.6 ? 'near_term' : freshest > 0.3 ? 'mid_term' : 'long_term' };
  out.facets.buying = facet(buyingVal, evidence);
  out.reasoning.push(reasoningTrace({ claim: 'buying_signal_strength', conclusion: opportunity, because: evidence, confidence, method: 'deterministic', assumptions: ['fixed signal weights + exponential decay'], unknowns: [] }));
  return out;
}
