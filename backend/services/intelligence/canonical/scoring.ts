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

/**
 * PI-SCORE-PROVENANCE-001 — the scoring-rules version.
 *
 * A persisted score that cannot name the rules that produced it is not
 * provenance; it is a number with a timestamp. This constant is that name.
 *
 * ─── WHAT IT COVERS ───────────────────────────────────────────────────────
 * The COMPLETE customer-visible scoring contract: every rule capable of
 * changing a LeadScore. That is the 14-file surface pinned by
 * `scripts/ci/scoring-surface-digest.json` — the nine contributing engines,
 * `leadUnderstanding/scoring.ts`, `projection.ts`, this combiner, and the ICP
 * evaluator plus its criteria vocabulary. Prioritization WEIGHTS live inside
 * that surface, which is the point: a weight edit is a scoring-rule change even
 * though it touches no formula in this file.
 *
 * ─── WHAT IT IS NOT ───────────────────────────────────────────────────────
 * Not `PROSPECT_API_VERSION` ('ws10.1'), which versions the RESPONSE SHAPE and
 * moves when a field is added to a payload that scores nothing. Not a migration
 * version, a database version, a deploy SHA, a git SHA or an app version: those
 * move for reasons unrelated to scoring, and a version that moves for unrelated
 * reasons cannot answer "which rules produced this score".
 *
 * ─── WHY THIS WORKSTREAM DID NOT BUMP IT ──────────────────────────────────
 * PI-SCORE-PROVENANCE-001 adds persistence and changes no scoring semantic, so
 * the initial value names the semantics already in force. Recording unchanged
 * rules under a NEW version would assert a change that did not happen.
 *
 * Format follows the repository's established rule-version convention —
 * `PROSPECT_RESOLUTION_VERSION = 'ws1.1'`, `ACCOUNT_RESOLUTION_VERSION = 'w4.1'`,
 * `SOCIAL_CONTACT_RESOLUTION_VERSION = 'b1.1'` — workstream, then revision.
 */
export const SCORING_RULES_VERSION = 'pi-score.1';

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
