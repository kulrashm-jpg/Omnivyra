/**
 * Q-C303 — Confidence Intelligence Engine (deterministic contributor). Represents evaluation stability,
 * uncertainty drivers, confidence strength, and abstention confidence — REUSING shared scoring (no new
 * confidence system). Refines the confidence facet and reinforces the fit dimension. Abstains when the
 * baseline abstains.
 */

import type { QualificationEngineOutput, QualificationIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runConfidence(ctx: QualificationIntelligenceContext): QualificationEngineOutput {
  const base = baselineOf(ctx);
  const conf = base?.facets.confidence?.value;
  const evalv = base?.facets.evaluation?.value;
  if (!base || !conf || conf.abstained) return emptyOutput('confidence');
  const src = ctx.raw?.source ?? 'qualification_eval', at = ctx.asOf;

  const confidence = clamp01(conf.confidence ?? 0);
  // uncertainty driver: unknown criteria reduce stability (fewer resolved criteria ⇒ less stable).
  const total = (evalv?.satisfied?.length ?? 0) + (evalv?.unsatisfied?.length ?? 0) + (evalv?.unknown?.length ?? 0);
  const unknownRatio = total ? (evalv?.unknown?.length ?? 0) / total : 1;
  const stability = clamp01(1 - unknownRatio * 0.7);
  const uncertainty = clamp01(1 - confidence);
  const driver = unknownRatio > 0.3 ? 'unknown_criteria' : 'evidence_thinness';

  const ev: EvidenceRef[] = [mkEvidence('confidence', { label: 'stability', value: Number(stability.toFixed(4)), source: src, observedAt: at, kind: 'inferred' })];
  const o: QualificationEngineOutput = { ...emptyOutput('confidence'), abstained: false, evidence: ev };
  o.facets.confidence = facet({ confidence, uncertainty, abstained: false }, ev);   // refine (higher-confidence merge wins)
  o.contributions.push({ dimension: 'fit', contributor: 'confidence', method: 'deterministic', value: clamp01(0.5 * confidence + 0.5 * stability), confidence: clamp01(0.4 + 0.1 * Math.min(total, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'confidence_stability', conclusion: Number(stability.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`confidence=${confidence}, uncertainty=${uncertainty}, driver=${driver}`], unknowns: [] }));
  return o;
}
