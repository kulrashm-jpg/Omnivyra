/**
 * I-C302 — Evidence Intelligence Engine (deterministic contributor). Analyzes the SUPPORTING evidence:
 * coverage, freshness, diversity, consistency, contradictory evidence. Interprets only — introduces NO
 * new evidence. Abstains without signals.
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { mkEvidence, clamp01, decayFactor, reasoningTrace, detectEvidenceContradictions, evidenceRef } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runEvidence(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const signals = ctx.raw?.signals ?? [];
  if (!signals.length) return emptyOutput('evidence');
  const src = ctx.raw?.source ?? 'intent_capture', at = ctx.asOf;

  const distinctObjectives = new Set(signals.map((s) => s.objective)).size;
  const distinctSources = new Set(signals.map((s) => s.source ?? src)).size;
  const freshestAt = signals.reduce((m, s) => (s.observedAt > m ? s.observedAt : m), signals[0].observedAt);
  const freshness = decayFactor(freshestAt, ctx.asOf, 45);
  const coverage = clamp01(signals.length / 8);
  const diversity = clamp01((distinctObjectives + distinctSources) / 6);

  // consistency = 1 − contradiction ratio over the reconstructed signal evidence (reuses shared detector).
  const signalEv = signals.map((s, i) => evidenceRef({ id: `intent:sig:${s.objective}:${i}:${s.source ?? src}:${s.observedAt}`, kind: 'observed', label: `signal:${s.objective}`, value: s.objective, source: { system: s.source ?? src }, observedAt: s.observedAt, recordedAt: s.observedAt }));
  const contradictions = detectEvidenceContradictions(signalEv);
  const consistency = clamp01(1 - contradictions.length / Math.max(1, signals.length));

  const ev: EvidenceRef[] = [
    mkEvidence('evidence', { label: 'coverage', value: signals.length, source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('evidence', { label: 'diversity', value: distinctObjectives, source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: IntentEngineOutput = { ...emptyOutput('evidence'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'breadth', contributor: 'evidence', method: 'deterministic', value: clamp01(0.5 * coverage + 0.5 * diversity), confidence: clamp01(0.4 + 0.1 * Math.min(signals.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'recency', contributor: 'evidence', method: 'deterministic', value: clamp01(freshness), confidence: clamp01(0.4 + 0.1 * Math.min(signals.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'evidence_quality', conclusion: Number(consistency.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`coverage=${signals.length}, diversity=${distinctObjectives}obj/${distinctSources}src, freshness=${clamp01(freshness)}, consistency=${consistency}`], unknowns: [] }));
  return o;
}
