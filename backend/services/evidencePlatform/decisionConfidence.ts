/**
 * Decision Confidence Adapter  (BETA-ENGINE-002)
 *
 * The single entry point decision engines use to obtain evidence-derived confidence. It does NOT
 * duplicate any calculation — it maps the measurable evidence a decision engine ALREADY computes onto
 * the canonical Confidence Engine's factors and returns its explainable readout. Deterministic, no AI.
 *
 * Decision engines are deterministic, so `calculationStability` is fixed at 1. Every other factor is
 * taken from real, already-computed evidence (sample size, data presence, maturity, completeness,
 * coverage, age) — nothing is invented.
 */
import { computeConfidence, type ConfidenceReadout } from './confidenceEngine';
import type { EvidenceMaturity } from './evidenceMaturity';

/** Evidence a decision engine already has on hand, in canonical terms. */
export interface DecisionEvidence {
  /** How the underlying data was obtained (MEASURED for crawl/GSC/analytics; INFERRED for on-site
   *  proxies like inferred backlink authority; DERIVED for external-signal aggregation). REQUIRED —
   *  every decision must declare its evidence maturity. */
  maturity: EvidenceMaturity;
  /** Number of underlying observations backing the decision (rows, pages, sessions, metric points). */
  sampleSize?: number | null;
  /** Whether the engine had real data for this decision (maps to validation). Defaults true. */
  dataPresent?: boolean;
  /** 0..1 fraction of expected inputs present, when the engine can measure it. */
  completeness?: number | null;
  /** 0..1 coverage, when the engine has a coverage notion. */
  coverage?: number | null;
  /** Age of the underlying evidence in hours, when known. */
  dataAgeHours?: number | null;
  /** Count of expected-but-missing measurements, when known. */
  missingMeasurements?: number | null;
  /** Provider reliability 0..1, when the engine knows its source reliability. */
  providerReliability?: number | null;
}

/** Obtain evidence-derived, explainable confidence for a decision. Single canonical path. */
export function deriveDecisionConfidence(ev: DecisionEvidence): ConfidenceReadout {
  return computeConfidence({
    maturity: ev.maturity,
    sampleSize: ev.sampleSize ?? null,
    validation: ev.dataPresent ?? true,
    completeness: ev.completeness ?? null,
    coverage: ev.coverage ?? null,
    dataAgeHours: ev.dataAgeHours ?? null,
    missingMeasurements: ev.missingMeasurements ?? null,
    providerReliability: ev.providerReliability ?? null,
    calculationStability: 1, // decision engines are deterministic
  });
}

/**
 * Compact, persistable explainability block for a decision's `evidence` field (Phase 8).
 * Exposes score, band, reason codes, and the per-factor breakdown without the full readout object.
 */
export function decisionConfidenceExplainability(readout: ConfidenceReadout): {
  score: number;
  band: string;
  maturity: string | null;
  reason_codes: string[];
  factors: Array<{ factor: string; value: number; weight: number; contribution: number }>;
} {
  return {
    score: readout.confidenceScore,
    band: readout.confidenceBand,
    maturity: readout.maturity,
    reason_codes: readout.reasonCodes,
    factors: readout.breakdown,
  };
}
