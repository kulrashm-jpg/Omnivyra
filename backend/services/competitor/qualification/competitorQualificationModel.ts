/**
 * COMPETITOR-TAXONOMY-P1/P2 — Multi-signal competitor qualification model.
 *
 * Replaces "taxonomy is the primary decision-maker" with an evidence-first, multi-signal
 * qualification that combines seven signals (see competitorSignalExtraction.ts) under a
 * calibrated weight profile. Taxonomy is demoted to a BOUNDED PRIOR: one small weighted
 * term that can nudge but never veto, and that fully abstains when the company's industry
 * is outside taxonomy coverage — so unseen industries are qualified on evidence alone.
 *
 * PURE & DETERMINISTIC — no I/O. This module carries NO live wiring; it is consumed by the
 * shadow observer (flag-dark) and by calibration/validation. The live decision path is
 * unchanged until the shadow is promoted.
 */

import type { CompanyCompetitiveContext, CompetitorCandidate } from '../../competitorEngineServiceModel';
import type { CategoryCoverage, CategoryAffinity } from '../../competitorTaxonomy';
import {
  extractQualificationSignals,
  type ExtractedSignals,
  type QualificationSignal,
  type QualificationSignalKey,
} from './competitorSignalExtraction';

export type QualificationDecision = 'qualified' | 'borderline' | 'unqualified';

export interface MultiSignalQualification {
  /** Aggregate qualification score in [0, 100]. */
  score: number;
  decision: QualificationDecision;
  signals: QualificationSignal[];
  taxonomyCoverage: CategoryCoverage;
  companyCategory: string;
  competitorCategory: string;
  affinity: CategoryAffinity;
  /** Effective (coverage-adjusted, renormalized) weight actually applied per signal. */
  effectiveWeights: Record<QualificationSignalKey, number>;
  weightProfile: string;
  explanation: string;
}

export interface QualificationWeightProfile {
  id: string;
  weights: Record<QualificationSignalKey, number>;
  /** Score at/above which a candidate qualifies. */
  qualifyThreshold: number;
  /** Score at/above which a candidate is borderline (below ⇒ unqualified). */
  borderlineThreshold: number;
}

/**
 * MULTISIGNAL_WEIGHT_PROFILE_V1 — calibrated on the cross-industry validation set
 * (see competitorQualificationCalibration.ts). Evidence signals dominate; taxonomy is a
 * bounded 0.10 prior. Weights sum to 1.0 but the model renormalizes over the signals that
 * have coverage on each candidate, so an abstaining signal (e.g. out-of-coverage taxonomy,
 * geography-less market) never silently drags the score toward zero.
 */
export const MULTISIGNAL_WEIGHT_PROFILE_V1: QualificationWeightProfile = {
  id: 'multisignal-v1',
  weights: {
    semanticSimilarity: 0.22,
    productOverlap: 0.2,
    icpOverlap: 0.15,
    marketOverlap: 0.12,
    businessModelSimilarity: 0.08,
    serpEvidence: 0.13,
    taxonomyPrior: 0.1,
  },
  qualifyThreshold: 55,
  borderlineThreshold: 40,
};

/**
 * MULTISIGNAL_WEIGHT_PROFILE_V2 — the ACTIVE, calibrated profile
 * (COMPETITOR-TAXONOMY-P2-CALIBRATION-001). Derived DETERMINISTICALLY, not hand-tuned, by
 * `deriveOptimizedProfile` over the 44-case cross-industry dataset: evidence share ∝ measured
 * value-discrimination Δ = mean(value|competitor) − mean(value|non-competitor), shrunk 50%
 * toward V1 (regularization) with a 0.05 evidence floor; taxonomy stays a bounded 0.10 prior.
 *
 * Versus V1 the audit found: `marketOverlap` under-weighted (highest discriminative efficiency,
 * lowest strong-signal weight), `semanticSimilarity` over-weighted for its separation power, and
 * `serpEvidence` non-discriminative when provenance is held constant (floored, not deleted, so it
 * still carries production provenance variation). V2 reallocates accordingly and is validated to
 * preserve precision/recall/F1 = 1.0 (0 FP, 0 FN) while WIDENING the qualified↔unqualified
 * separation gap 32 → 36 and both decision margins by +2. All seven weights are stable (0 decision
 * flips under ±10%/±20% perturbation). Regression-locked in competitorCalibrationAnalysis.test.ts.
 *
 * NOTE: this is a shadow-model calibration only — the shadow is NOT promoted and NOT deployed.
 */
export const MULTISIGNAL_WEIGHT_PROFILE_V2: QualificationWeightProfile = {
  id: 'multisignal-v2',
  weights: {
    semanticSimilarity: 0.19,
    productOverlap: 0.21,
    icpOverlap: 0.17,
    marketOverlap: 0.17,
    businessModelSimilarity: 0.09,
    serpEvidence: 0.07,
    taxonomyPrior: 0.1,
  },
  qualifyThreshold: 55,
  borderlineThreshold: 40,
};

/** The active default profile the shadow model scores with. */
export const MULTISIGNAL_WEIGHT_PROFILE: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V2;

const SIGNAL_ORDER: QualificationSignalKey[] = [
  'semanticSimilarity',
  'productOverlap',
  'icpOverlap',
  'marketOverlap',
  'businessModelSimilarity',
  'serpEvidence',
  'taxonomyPrior',
];

function decideFromScore(score: number, profile: QualificationWeightProfile): QualificationDecision {
  if (score >= profile.qualifyThreshold) return 'qualified';
  if (score >= profile.borderlineThreshold) return 'borderline';
  return 'unqualified';
}

/**
 * Aggregate the extracted signals into a qualification. Each signal's *effective* weight is
 * `baseWeight × coverage`; the aggregate is the coverage-weighted mean over signals with
 * positive effective weight, so abstaining signals are excluded from BOTH numerator and
 * denominator (they neither help nor penalize). This is the mechanism that removes the
 * taxonomy-coverage dependency: out-of-coverage ⇒ taxonomy effective weight 0 ⇒ decision
 * is a renormalized blend of the six evidence signals.
 */
export function aggregateQualification(
  extracted: ExtractedSignals,
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE,
): MultiSignalQualification {
  const effectiveWeights = {} as Record<QualificationSignalKey, number>;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of SIGNAL_ORDER) {
    const signal = extracted.signals[key];
    const effective = profile.weights[key] * Math.max(0, Math.min(1, signal.coverage));
    effectiveWeights[key] = Number(effective.toFixed(4));
    weightedSum += effective * Math.max(0, Math.min(1, signal.value));
    totalWeight += effective;
  }

  const normalized = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const score = Math.round(Math.max(0, Math.min(1, normalized)) * 100);
  const decision = decideFromScore(score, profile);
  const signals = SIGNAL_ORDER.map((key) => extracted.signals[key]);

  const drivers = [...signals]
    .filter((s) => s.coverage > 0)
    .sort((a, b) => b.value * profile.weights[b.key] - a.value * profile.weights[a.key])
    .slice(0, 3)
    .map((s) => s.key)
    .join(', ');

  return {
    score,
    decision,
    signals,
    taxonomyCoverage: extracted.taxonomyCoverage,
    companyCategory: extracted.companyCategory,
    competitorCategory: extracted.competitorCategory,
    affinity: extracted.affinity,
    effectiveWeights,
    weightProfile: profile.id,
    explanation: `${decision} (score ${score}/100, profile ${profile.id}, taxonomy ${extracted.taxonomyCoverage}${
      extracted.taxonomyCoverage === 'out_of_coverage' ? ' — decided on evidence, taxonomy abstained' : ''
    }; top drivers: ${drivers || 'none'})`,
  };
}

/** Convenience: extract + aggregate for one candidate. Pure, deterministic. */
export function evaluateMultiSignalQualification(
  candidate: CompetitorCandidate,
  context: CompanyCompetitiveContext,
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE,
): MultiSignalQualification {
  return aggregateQualification(extractQualificationSignals(candidate, context), profile);
}
