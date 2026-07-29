/**
 * I-C304 — Conflict Intelligence Engine (deterministic contributor). Represents situations where
 * evidence supports MULTIPLE objectives: competing objectives, contradiction summaries, ambiguity,
 * unresolved interpretation. Intent DESCRIBES conflicts — it never forces resolution. Abstains when
 * there is a single clear objective (no conflict to describe).
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace, detectEvidenceContradictions, evidenceRef } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runConflict(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const base = baselineOf(ctx);
  const candidates = base?.facets.competingIntents?.value?.candidates ?? [];
  const signals = ctx.raw?.signals ?? [];
  if (!base || candidates.length < 2) return emptyOutput('conflict');   // no competing objective ⇒ nothing to describe
  const src = ctx.raw?.source ?? 'intent_capture', at = ctx.asOf;

  const c0 = candidates[0].confidence, c1 = candidates[1].confidence;
  const ambiguity = clamp01(c1 / Math.max(c0, 1e-6));                   // runner-up close to leader ⇒ ambiguous
  const competing = candidates.slice(1).filter((c) => c.confidence >= 0.5 * c0).map((c) => c.objective);
  const signalEv = signals.map((s, i) => evidenceRef({ id: `intent:cf:${s.objective}:${i}:${s.source ?? src}:${s.observedAt}`, kind: 'observed', label: `signal:${s.objective}`, value: s.objective, source: { system: s.source ?? src }, observedAt: s.observedAt, recordedAt: s.observedAt }));
  const contradictions = detectEvidenceContradictions(signalEv);
  const unresolved = ambiguity >= 0.85;                                // near-tie ⇒ unresolved interpretation

  const ev: EvidenceRef[] = [mkEvidence('conflict', { label: 'ambiguity', value: Number(ambiguity.toFixed(4)), source: src, observedAt: at, kind: 'inferred' })];
  const o: IntentEngineOutput = { ...emptyOutput('conflict'), abstained: false, evidence: ev };
  // clarity FALLS as ambiguity rises (describes, does not resolve).
  o.contributions.push({ dimension: 'clarity', contributor: 'conflict', method: 'deterministic', value: clamp01(1 - ambiguity), confidence: clamp01(0.4 + 0.1 * Math.min(candidates.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'interpretation_conflict', conclusion: unresolved ? 'unresolved' : 'resolved_lean', because: ev, confidence: 0.55, method: 'deterministic', assumptions: [`competing=[${competing.join(', ')}], ambiguity=${ambiguity}, contradictions=${contradictions.length}`], unknowns: unresolved ? ['dominant objective unresolved — evidence supports multiple'] : [] }));
  return o;
}
