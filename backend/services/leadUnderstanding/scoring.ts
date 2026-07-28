/**
 * LI-B103 — Unified Lead Scoring contract (pure, deterministic combiner).
 *
 * There is ONE final score. Engines are CONTRIBUTORS (`ScoreContribution`) — no engine owns the
 * final score. The combiner supports deterministic + probabilistic + ai_reasoned methods, confidence,
 * calibration (agreement across contributors), and ABSTENTION (null when no contributor has evidence).
 * This file contains NO scoring algorithm — algorithms live in Phase C engines and feed contributions.
 */

import type { ScoreContribution, DimensionScore, LeadScore, ScoreDimension, ScoringMethod } from './types';
import { SCORE_DIMENSIONS } from './types';

/** Method precedence — deterministic evidence outweighs probabilistic/AI at equal confidence. */
const METHOD_WEIGHT: Record<ScoringMethod, number> = { deterministic: 1.0, probabilistic: 0.8, ai_reasoned: 0.7 };

export interface ScoringConfig { agreementTolerance?: number } // default 0.15

/** Combine all contributions for ONE dimension into a single DimensionScore. */
export function combineDimension(dimension: ScoreDimension, contributions: ScoreContribution[], config: ScoringConfig = {}): DimensionScore {
  const tol = config.agreementTolerance ?? 0.15;
  // Abstention: only contributions with a real value AND supporting evidence count.
  const usable = contributions.filter((c) => c.dimension === dimension && c.value !== null && c.evidence.length > 0);
  if (usable.length === 0) {
    return { dimension, value: null, confidence: 0, method: 'blended', contributors: [], calibrated: false, abstained: true };
  }
  // Weighted blend: weight = confidence * method precedence. Never lets a low-confidence AI source
  // overwrite a high-confidence deterministic one — the weighting encodes precedence.
  let wSum = 0, vSum = 0;
  for (const c of usable) { const w = c.confidence * METHOD_WEIGHT[c.method]; wSum += w; vSum += w * (c.value as number); }
  const value = wSum > 0 ? Number((vSum / wSum).toFixed(4)) : null;
  // Calibration: >1 contributor AND max pairwise disagreement within tolerance.
  const values = usable.map((c) => c.value as number);
  const spread = Math.max(...values) - Math.min(...values);
  const calibrated = usable.length > 1 && spread <= tol;
  // Confidence: best contributor confidence, boosted when calibrated, dampened on disagreement.
  const maxConf = Math.max(...usable.map((c) => c.confidence));
  const confidence = Number(Math.max(0, Math.min(1, calibrated ? Math.min(1, maxConf + 0.1) : maxConf * (spread > tol ? 0.85 : 1))).toFixed(4));
  const methods = new Set(usable.map((c) => c.method));
  const method: DimensionScore['method'] = methods.size === 1 ? [...methods][0] : 'blended';
  return {
    dimension, value, confidence, method,
    contributors: [...new Set(usable.map((c) => c.contributor))].sort(),
    calibrated, abstained: false,
  };
}

/** Combine contributions across ALL dimensions into the canonical LeadScore. */
export function combineScores(contributions: ScoreContribution[], config: ScoringConfig = {}): LeadScore {
  const dimensions = {} as Record<ScoreDimension, DimensionScore>;
  for (const d of SCORE_DIMENSIONS) dimensions[d] = combineDimension(d, contributions, config);
  // Overall: confidence-weighted mean of non-abstained dimensions; null if every dimension abstains.
  const scored = SCORE_DIMENSIONS.map((d) => dimensions[d]).filter((s) => !s.abstained && s.value !== null);
  let overall: number | null = null, confidence = 0;
  if (scored.length) {
    let wSum = 0, vSum = 0;
    for (const s of scored) { wSum += s.confidence; vSum += s.confidence * (s.value as number); }
    overall = wSum > 0 ? Number((vSum / wSum).toFixed(4)) : Number((scored.reduce((a, s) => a + (s.value as number), 0) / scored.length).toFixed(4));
    confidence = Number((scored.reduce((a, s) => a + s.confidence, 0) / scored.length).toFixed(4));
  }
  return { dimensions, overall, confidence };
}
