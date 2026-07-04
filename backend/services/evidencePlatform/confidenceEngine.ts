/**
 * Canonical Confidence Engine  (BETA-ENGINE-001)
 *
 * The single deterministic, evidence-derived confidence calculation for the whole Intelligence
 * Platform. It is PURE — no AI, no probability, no clock/random — so identical evidence always yields
 * identical confidence. It consumes ONLY measurable evidence factors and produces a fully explainable
 * readout: a score, a band, every factor's individual contribution, and machine-readable reason codes.
 *
 * It builds on the BETA-ARCH-001 `CanonicalConfidence` contract (this engine is its implementation)
 * and the shared `EvidenceMaturity` vocabulary. It does NOT read or write any engine score — callers
 * attach its output as optional metadata (per the platform's non-breaking contract).
 */
import type { CanonicalConfidence, ConfidenceBand } from './confidenceContract';
import type { EvidenceMaturity } from './evidenceMaturity';

// ── deterministic constants (documented, individually tunable) ────────────────

/** Factor weights. Only PROVIDED factors contribute; weights are renormalized over them. */
export const CONFIDENCE_WEIGHTS = {
  coverage: 0.28,
  completeness: 0.14,
  freshness: 0.14,
  maturity: 0.14,
  sampleSize: 0.12,
  validation: 0.08,
  providerReliability: 0.06,
  calculationStability: 0.04,
} as const;

/** Evidence age (hours) at which freshness has fully decayed to 0. Mirrors the freshness primitive. */
export const FRESHNESS_STALE_HOURS = 14 * 24;
/** Sample size treated as "fully saturated" (freshness of evidence volume). */
export const SAMPLE_SATURATION = 12;

/** Deterministic maturity → reliability weight (0..1). Strongest evidence scores highest. */
export const MATURITY_WEIGHT: Record<EvidenceMaturity, number> = {
  MEASURED: 1.0,
  OBSERVED: 0.9,
  CALCULATED: 0.85,
  DERIVED: 0.75,
  INFERRED: 0.5,
  ESTIMATED: 0.4,
  UNKNOWN: 0.3,
  SYNTHETIC: 0.2,
  MOCK: 0.1,
  NOT_EVALUABLE: 0.0,
  UNAVAILABLE: 0.0,
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── inputs / outputs ──────────────────────────────────────────────────────────

/** Every factor is optional + measurable. Omitted factors simply do not contribute. */
export interface ConfidenceFactors {
  /** Evaluable / total checks (0..1). */
  coverage?: number | null;
  /** Present required inputs / required inputs (0..1). */
  completeness?: number | null;
  /** Direct freshness (0..1). If absent, derived from `dataAgeHours`. */
  freshness?: number | null;
  /** Age of the underlying evidence in hours (used to derive freshness). */
  dataAgeHours?: number | null;
  /** Number of underlying observations. */
  sampleSize?: number | null;
  /** Whether the evidence passed validation. */
  validation?: boolean | null;
  /** The dominant maturity of the underlying evidence. */
  maturity?: EvidenceMaturity | null;
  /** Source reliability (0..1). */
  providerReliability?: number | null;
  /** Determinism of the calculation (0..1; deterministic engines = 1). */
  calculationStability?: number | null;
  /** Count of measurements that are missing (not present). */
  missingMeasurements?: number | null;
  /** Count of measurements that exist but are unavailable/not_evaluable. */
  unavailableMeasurements?: number | null;
  /** Total evidence items considered (for evidenceCount passthrough). */
  evidenceCount?: number | null;
  /** Human labels of what is missing (surfaced verbatim in the readout). */
  missingEvidenceLabels?: string[];
}

/** One factor's contribution to the blended score. */
export interface FactorContribution {
  factor: string;
  value: number; // normalized 0..1
  weight: number; // renormalized weight actually applied
  contribution: number; // value * weight
}

/** The fully explainable confidence output (extends the canonical contract). */
export interface ConfidenceReadout extends CanonicalConfidence {
  confidenceScore: number; // 0..1, always present
  confidenceBand: ConfidenceBand;
  evidenceCount: number | null;
  maturity: EvidenceMaturity | null;
  missingEvidence: string[];
  /** Per-factor breakdown — the score is exactly sum(contribution). */
  breakdown: FactorContribution[];
  /** Deterministic machine-readable reason codes explaining the score. */
  reasonCodes: string[];
}

function bandOf(score: number): ConfidenceBand {
  if (score >= 0.66) return 'high';
  if (score >= 0.33) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

/** Derive freshness (0..1) from age in hours, linear decay to `FRESHNESS_STALE_HOURS`. */
function freshnessFromAge(ageHours: number): number {
  return clamp01(1 - ageHours / FRESHNESS_STALE_HOURS);
}

/**
 * The single canonical confidence calculation. Deterministic + explainable.
 * Blends only the factors actually provided (weights renormalized over them), so an engine can adopt
 * incrementally and the score always reflects exactly the evidence supplied.
 */
export function computeConfidence(factors: ConfidenceFactors): ConfidenceReadout {
  const parts: Array<{ factor: keyof typeof CONFIDENCE_WEIGHTS; value: number }> = [];

  if (factors.coverage != null) parts.push({ factor: 'coverage', value: clamp01(factors.coverage) });
  if (factors.completeness != null) parts.push({ factor: 'completeness', value: clamp01(factors.completeness) });

  let freshnessValue: number | null = null;
  if (factors.freshness != null) freshnessValue = clamp01(factors.freshness);
  else if (factors.dataAgeHours != null) freshnessValue = freshnessFromAge(Math.max(0, factors.dataAgeHours));
  if (freshnessValue != null) parts.push({ factor: 'freshness', value: freshnessValue });

  if (factors.maturity != null) parts.push({ factor: 'maturity', value: MATURITY_WEIGHT[factors.maturity] ?? 0.3 });
  if (factors.sampleSize != null) parts.push({ factor: 'sampleSize', value: clamp01(factors.sampleSize / SAMPLE_SATURATION) });
  if (factors.validation != null) parts.push({ factor: 'validation', value: factors.validation ? 1 : 0 });
  if (factors.providerReliability != null) parts.push({ factor: 'providerReliability', value: clamp01(factors.providerReliability) });
  if (factors.calculationStability != null) parts.push({ factor: 'calculationStability', value: clamp01(factors.calculationStability) });

  // Renormalize weights over the factors actually present.
  const totalWeight = parts.reduce((sum, p) => sum + CONFIDENCE_WEIGHTS[p.factor], 0);
  const breakdown: FactorContribution[] = parts.map((p) => {
    const weight = totalWeight > 0 ? CONFIDENCE_WEIGHTS[p.factor] / totalWeight : 0;
    return { factor: p.factor, value: round2(p.value), weight: round2(weight), contribution: round2(p.value * weight) };
  });
  const score = round2(breakdown.reduce((sum, b) => sum + b.value * b.weight, 0));

  // Deterministic reason codes.
  const reasonCodes: string[] = [];
  const val = (f: string) => parts.find((p) => p.factor === f)?.value ?? null;
  if (parts.length === 0) reasonCodes.push('NO_EVIDENCE_FACTORS');
  const cov = val('coverage');
  if (cov != null) reasonCodes.push(cov >= 0.8 ? 'HIGH_COVERAGE' : cov < 0.4 ? 'LOW_COVERAGE' : 'PARTIAL_COVERAGE');
  if (freshnessValue != null && freshnessValue < 0.5) reasonCodes.push('STALE_EVIDENCE');
  if (factors.sampleSize != null && factors.sampleSize < 3) reasonCodes.push('SMALL_SAMPLE');
  if (factors.maturity != null && (MATURITY_WEIGHT[factors.maturity] ?? 0.3) < 0.6) reasonCodes.push(`LOW_MATURITY:${factors.maturity}`);
  if (factors.validation === false) reasonCodes.push('UNVALIDATED');
  if ((factors.missingMeasurements ?? 0) > 0) reasonCodes.push(`MISSING_MEASUREMENTS:${factors.missingMeasurements}`);
  if ((factors.unavailableMeasurements ?? 0) > 0) reasonCodes.push(`UNAVAILABLE_MEASUREMENTS:${factors.unavailableMeasurements}`);
  if (score >= 0.66 && cov != null && cov >= 0.8) reasonCodes.push('STRONG_EVIDENCE');

  return {
    confidenceScore: score,
    confidenceBand: bandOf(score),
    coverage: factors.coverage ?? null,
    freshness: freshnessValue,
    completeness: factors.completeness ?? null,
    reliability: factors.providerReliability ?? null,
    sampleSize: factors.sampleSize ?? null,
    validation: factors.validation ?? null,
    evidenceCount: factors.evidenceCount ?? null,
    maturity: factors.maturity ?? null,
    missingEvidence: factors.missingEvidenceLabels ?? [],
    breakdown,
    reasonCodes,
  };
}
