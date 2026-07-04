/**
 * Canonical Evidence Maturity Model  (BETA-ARCH-001, Phase 2)
 *
 * The single vocabulary every intelligence engine uses to declare HOW an output was produced.
 * This is a classification only — it performs no calculation and changes no engine behaviour.
 * Ordered loosely from strongest (real measurement) to weakest (fabricated / unknown).
 */

export const EVIDENCE_MATURITY = {
  /** Directly measured from a real external/first-party source (e.g. GSC impressions, crawl counts). */
  MEASURED: 'MEASURED',
  /** Observed from stored state that was itself captured (e.g. a stored crawl row, a session flag). */
  OBSERVED: 'OBSERVED',
  /** Deterministically computed from measured/observed inputs (e.g. a ratio, an average). */
  CALCULATED: 'CALCULATED',
  /** Derived through a multi-step deterministic transform over other evidence. */
  DERIVED: 'DERIVED',
  /** Inferred from proxy signals rather than the thing itself (e.g. authority from on-site cues). */
  INFERRED: 'INFERRED',
  /** Estimated via heuristic when the true value is unavailable (e.g. a bucketed default). */
  ESTIMATED: 'ESTIMATED',
  /** The value is unavailable — no data, honest gap (distinct from a fabricated default). */
  UNAVAILABLE: 'UNAVAILABLE',
  /** The check exists but cannot be evaluated with the current data source (honest capability gap). */
  NOT_EVALUABLE: 'NOT_EVALUABLE',
  /** A synthetic/templated value not tied to this subject's real data (e.g. fallback fixtures). */
  SYNTHETIC: 'SYNTHETIC',
  /** A mock value used for tests/fixtures — must never appear in production output. */
  MOCK: 'MOCK',
  /** Maturity has not been declared. */
  UNKNOWN: 'UNKNOWN',
} as const;

export type EvidenceMaturity = (typeof EVIDENCE_MATURITY)[keyof typeof EVIDENCE_MATURITY];

/** All maturity states, in strength order (strongest first). */
export const EVIDENCE_MATURITY_ORDER: EvidenceMaturity[] = [
  'MEASURED',
  'OBSERVED',
  'CALCULATED',
  'DERIVED',
  'INFERRED',
  'ESTIMATED',
  'NOT_EVALUABLE',
  'UNAVAILABLE',
  'SYNTHETIC',
  'MOCK',
  'UNKNOWN',
];

/** True when the maturity represents a real, trustworthy signal (measured/observed/calculated/derived). */
export function isTrustedMaturity(m: EvidenceMaturity): boolean {
  return m === 'MEASURED' || m === 'OBSERVED' || m === 'CALCULATED' || m === 'DERIVED';
}

/** True when the maturity represents an honest gap rather than a value (unavailable/not_evaluable). */
export function isGapMaturity(m: EvidenceMaturity): boolean {
  return m === 'UNAVAILABLE' || m === 'NOT_EVALUABLE';
}

/** True when the value is fabricated and should be treated with caution (synthetic/mock). */
export function isFabricatedMaturity(m: EvidenceMaturity): boolean {
  return m === 'SYNTHETIC' || m === 'MOCK';
}

/** Normalise an arbitrary string into a known maturity, defaulting to UNKNOWN (never throws). */
export function toEvidenceMaturity(value: string | null | undefined): EvidenceMaturity {
  if (!value) return 'UNKNOWN';
  const upper = value.toUpperCase();
  return (EVIDENCE_MATURITY_ORDER as string[]).includes(upper) ? (upper as EvidenceMaturity) : 'UNKNOWN';
}
