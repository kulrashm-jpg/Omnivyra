/**
 * I-C303 — Confidence Intelligence Engine (deterministic contributor). Represents confidence stability,
 * uncertainty drivers, and abstention confidence — REUSING shared scoring (no new confidence system).
 * Refines the confidence facet and reinforces the strength dimension. Abstains when the baseline abstains.
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runConfidence(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const base = baselineOf(ctx);
  const conf = base?.facets.confidence?.value;
  const candidates = base?.facets.competingIntents?.value?.candidates ?? [];
  if (!base || !conf || conf.abstained) return emptyOutput('confidence');
  const src = ctx.raw?.source ?? 'intent_capture', at = ctx.asOf;

  const confidence = clamp01(conf.confidence ?? 0);
  // uncertainty driver: competing objectives near the leader raise uncertainty (stability falls).
  const c0 = candidates[0]?.confidence ?? 0, c1 = candidates[1]?.confidence ?? 0;
  const stability = clamp01(1 - (c1 / Math.max(c0, 1e-6)) * 0.5);
  const uncertainty = clamp01(1 - confidence);
  const driver = c1 > 0.5 * c0 ? 'competing_objectives' : 'evidence_thinness';

  const ev: EvidenceRef[] = [mkEvidence('confidence', { label: 'stability', value: Number(stability.toFixed(4)), source: src, observedAt: at, kind: 'inferred' })];
  const o: IntentEngineOutput = { ...emptyOutput('confidence'), abstained: false, evidence: ev };
  o.facets.confidence = facet({ confidence, uncertainty, abstained: false }, ev);   // refine (higher-confidence merge wins)
  o.contributions.push({ dimension: 'strength', contributor: 'confidence', method: 'deterministic', value: clamp01(0.5 * confidence + 0.5 * stability), confidence: clamp01(0.4 + 0.1 * Math.min(candidates.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'confidence_stability', conclusion: Number(stability.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`confidence=${confidence}, uncertainty=${uncertainty}, driver=${driver}`], unknowns: [] }));
  return o;
}
