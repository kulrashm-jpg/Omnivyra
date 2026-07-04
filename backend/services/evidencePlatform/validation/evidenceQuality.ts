/**
 * Evidence Quality Model  (BETA-ENGINE-008, Phase 3)
 *
 * A deterministic, explainable quality assessment for a canonical Evidence set. Distinct from confidence:
 * confidence answers "how sure is the decision?", quality answers "how trustworthy is the evidence itself?".
 * Pure — derived from the validation report + the evidence rows; no clock, no randomness, no AI.
 */
import type { Evidence } from '../evidenceModel';
import type { EvidenceValidationReport } from './evidenceValidation';

export type QualityBand = 'excellent' | 'good' | 'fair' | 'poor' | 'unusable';

export interface QualityFactor {
  factor: string;
  value: number; // 0..1
  weight: number;
  contribution: number;
}

export interface EvidenceQualityAssessment {
  qualityScore: number; // 0..1
  qualityBand: QualityBand;
  completeness: number; // 0..1 measured / total
  consistency: number; // 0..1 (1 - conflict fraction)
  freshness: number; // 0..1 (mean per-row freshness; 1 when no age known)
  validity: number; // 0..1 validated / total
  providerReliability: number | null;
  conflictCount: number;
  missingFields: number;
  breakdown: QualityFactor[];
  reasons: string[];
}

/** Deterministic weights (renormalised over the factors actually present). */
const WEIGHTS = { validity: 0.34, completeness: 0.22, consistency: 0.20, freshness: 0.14, providerReliability: 0.10 };

const isMeasured = (e: Evidence): boolean => e.maturity !== 'UNAVAILABLE' && e.value != null;

function bandFor(score: number): QualityBand {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.7) return 'good';
  if (score >= 0.5) return 'fair';
  if (score > 0) return 'poor';
  return 'unusable';
}

export interface QualityInput {
  evidence: Evidence[];
  validation: EvidenceValidationReport;
  providerReliability?: number | null;
  conflictCount?: number;
}

export function assessEvidenceQuality(input: QualityInput): EvidenceQualityAssessment {
  const { evidence, validation } = input;
  const total = evidence.length;
  const measured = evidence.filter(isMeasured).length;

  const validity = total > 0 ? validation.validatedCount / total : 0;
  const completeness = total > 0 ? measured / total : 0;
  const conflictCount = input.conflictCount ?? 0;
  const consistency = measured > 0 ? Math.max(0, 1 - conflictCount / measured) : 1;

  // Per-row freshness from the canonical freshness descriptor (1 when unknown — not penalised).
  const freshVals = evidence
    .map((e) => (typeof e.confidence?.freshness === 'number' ? e.confidence.freshness : null))
    .filter((v): v is number => v != null);
  const freshness = freshVals.length ? freshVals.reduce((a, b) => a + b, 0) / freshVals.length : 1;

  const providerReliability = input.providerReliability ?? null;

  // Renormalise over present factors (providerReliability optional).
  const present: Array<[string, number, number]> = [
    ['validity', validity, WEIGHTS.validity],
    ['completeness', completeness, WEIGHTS.completeness],
    ['consistency', consistency, WEIGHTS.consistency],
    ['freshness', freshness, WEIGHTS.freshness],
  ];
  if (providerReliability != null) present.push(['providerReliability', providerReliability, WEIGHTS.providerReliability]);
  const weightSum = present.reduce((s, [, , w]) => s + w, 0);
  const breakdown: QualityFactor[] = present.map(([factor, value, w]) => {
    const weight = w / weightSum;
    return { factor, value: Math.round(value * 10000) / 10000, weight: Math.round(weight * 10000) / 10000, contribution: Math.round(value * weight * 10000) / 10000 };
  });
  const qualityScore = Math.round(breakdown.reduce((s, f) => s + f.contribution, 0) * 10000) / 10000;

  const reasons: string[] = [];
  if (validation.rejectedCount > 0) reasons.push(`${validation.rejectedCount} row(s) rejected`);
  if (validation.flaggedCount > 0) reasons.push(`${validation.flaggedCount} row(s) flagged`);
  if (conflictCount > 0) reasons.push(`${conflictCount} conflict(s)`);
  if (measured < total) reasons.push(`${total - measured} unavailable row(s)`);
  if (reasons.length === 0) reasons.push('all evidence validated, complete, consistent');

  return {
    qualityScore,
    qualityBand: bandFor(qualityScore),
    completeness: Math.round(completeness * 10000) / 10000,
    consistency: Math.round(consistency * 10000) / 10000,
    freshness: Math.round(freshness * 10000) / 10000,
    validity: Math.round(validity * 10000) / 10000,
    providerReliability,
    conflictCount,
    missingFields: total - measured,
    breakdown,
    reasons,
  };
}
