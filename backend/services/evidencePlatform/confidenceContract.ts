/**
 * Platform Confidence Contract  (BETA-ARCH-001, Phase 4)
 *
 * The canonical SHAPE of confidence for the whole platform. This phase defines the interface ONLY —
 * it deliberately performs NO confidence calculation and does NOT replace any engine's existing
 * confidence (per the phase's non-negotiable rules). Engines may attach a `CanonicalConfidence`
 * descriptor as optional metadata; the actual evidence-scaled computation is a later phase.
 */

export const CONFIDENCE_BAND = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none',
} as const;

export type ConfidenceBand = (typeof CONFIDENCE_BAND)[keyof typeof CONFIDENCE_BAND];

/**
 * The canonical confidence descriptor. Every field is optional so an engine can adopt the contract
 * incrementally (declare only what it knows today). No field is computed by this module.
 */
export interface CanonicalConfidence {
  /** Fraction of the intended checks/inputs that were actually evaluable (0..1). */
  coverage?: number | null;
  /** Recency signal (0..1, 1 = fresh) — derived from freshness, not computed here. */
  freshness?: number | null;
  /** Fraction of required inputs that were present (0..1). */
  completeness?: number | null;
  /** Source reliability (0..1) — how trustworthy the underlying source is. */
  reliability?: number | null;
  /** Number of underlying observations the value rests on. */
  sampleSize?: number | null;
  /** Whether the value passed validation (see ValidationStatus). */
  validation?: boolean | null;
  /** The engine's own scalar confidence (0..1) — PRESERVED as-is; not recomputed. */
  confidenceScore?: number | null;
  /** The banded confidence. */
  confidenceBand?: ConfidenceBand;
}

/** An empty, fully-optional confidence descriptor (adoption placeholder — computes nothing). */
export function emptyConfidence(): CanonicalConfidence {
  return {};
}

/**
 * Wrap an engine's EXISTING scalar confidence (0..1) into the canonical descriptor WITHOUT
 * recomputing it. This is a pure passthrough so adoption never changes confidence behaviour.
 * The band is a presentational mapping of the passed-in score; it does not alter the score.
 */
export function fromEngineConfidence(
  confidenceScore: number | null | undefined,
  extra?: Partial<CanonicalConfidence>,
): CanonicalConfidence {
  const score = typeof confidenceScore === 'number' && Number.isFinite(confidenceScore) ? confidenceScore : null;
  let band: ConfidenceBand = 'none';
  if (score != null) band = score >= 0.66 ? 'high' : score >= 0.33 ? 'medium' : 'low';
  return { confidenceScore: score, confidenceBand: band, ...extra };
}
