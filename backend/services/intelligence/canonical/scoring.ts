/**
 * Shared canonical SCORING contract (dimension-generic). The same confidence-weighted, method-
 * precedence, abstention-aware, calibration blend Program 1 uses — generalized over the dimension
 * set so Company (and Offering) reuse ONE scoring algorithm rather than forking it. No engine owns
 * the final score; engines emit `ScoreContribution`s and the combiner blends them.
 *
 * NOTE: Program 1's `leadUnderstanding/scoring.ts` is the certified specialization of this exact
 * algorithm over the lead dimension union; a later non-breaking follow-up re-points it here.
 */

import type { EvidenceRef, ISOTimestamp } from './contracts';

export type ScoringMethod = 'deterministic' | 'probabilistic' | 'ai_reasoned';
const METHOD_WEIGHT: Record<ScoringMethod, number> = { deterministic: 1.0, probabilistic: 0.8, ai_reasoned: 0.7 };

export interface ScoreContribution<D extends string> {
  dimension: D; contributor: string; method: ScoringMethod;
  value: number | null; confidence: number; evidence: EvidenceRef[]; asOf: ISOTimestamp | null;
}
export interface DimensionScore<D extends string> {
  dimension: D; value: number | null; confidence: number;
  method: ScoringMethod | 'blended'; contributors: string[]; calibrated: boolean; abstained: boolean;
}
export interface CanonicalScore<D extends string> { dimensions: Record<D, DimensionScore<D>>; overall: number | null; confidence: number; }

export interface ScoringConfig { agreementTolerance?: number }

export function combineDimension<D extends string>(dimension: D, contributions: ScoreContribution<D>[], config: ScoringConfig = {}): DimensionScore<D> {
  const tol = config.agreementTolerance ?? 0.15;
  const usable = contributions.filter((c) => c.dimension === dimension && c.value !== null && c.evidence.length > 0);
  if (usable.length === 0) return { dimension, value: null, confidence: 0, method: 'blended', contributors: [], calibrated: false, abstained: true };
  let wSum = 0, vSum = 0;
  for (const c of usable) { const w = c.confidence * METHOD_WEIGHT[c.method]; wSum += w; vSum += w * (c.value as number); }
  const value = wSum > 0 ? Number((vSum / wSum).toFixed(4)) : null;
  const values = usable.map((c) => c.value as number);
  const spread = Math.max(...values) - Math.min(...values);
  const calibrated = usable.length > 1 && spread <= tol;
  const maxConf = Math.max(...usable.map((c) => c.confidence));
  const confidence = Number(Math.max(0, Math.min(1, calibrated ? Math.min(1, maxConf + 0.1) : maxConf * (spread > tol ? 0.85 : 1))).toFixed(4));
  const methods = new Set(usable.map((c) => c.method));
  const method: DimensionScore<D>['method'] = methods.size === 1 ? [...methods][0] : 'blended';
  return { dimension, value, confidence, method, contributors: [...new Set(usable.map((c) => c.contributor))].sort(), calibrated, abstained: false };
}

export function combineScoresFor<D extends string>(dims: readonly D[], contributions: ScoreContribution<D>[], config: ScoringConfig = {}): CanonicalScore<D> {
  const dimensions = {} as Record<D, DimensionScore<D>>;
  for (const d of dims) dimensions[d] = combineDimension(d, contributions, config);
  const scored = dims.map((d) => dimensions[d]).filter((s) => !s.abstained && s.value !== null);
  let overall: number | null = null, confidence = 0;
  if (scored.length) {
    let wSum = 0, vSum = 0;
    for (const s of scored) { wSum += s.confidence; vSum += s.confidence * (s.value as number); }
    overall = wSum > 0 ? Number((vSum / wSum).toFixed(4)) : Number((scored.reduce((a, s) => a + (s.value as number), 0) / scored.length).toFixed(4));
    confidence = Number((scored.reduce((a, s) => a + s.confidence, 0) / scored.length).toFixed(4));
  }
  return { dimensions, overall, confidence };
}
