/**
 * COMPETITOR-TAXONOMY-P2-CALIBRATION-001 — Calibration analysis engine.
 *
 * Measurement-only tooling for auditing the multi-signal weight profile. It does NOT change
 * the model architecture, aggregation, or live wiring — it decomposes what the existing model
 * already computes and derives an evidence-based weight recommendation deterministically (no
 * hand-tuning). Everything here is pure and reproducible.
 *
 * Provides:
 *   • decomposeContributions — per-signal value / effective weight / contribution / dominance
 *   • signalDiscrimination   — how well each signal separates competitors from non-competitors
 *   • sensitivitySweep       — decision stability under ±10% / ±20% per-weight perturbation
 *   • deriveOptimizedProfile — discrimination-tilted, shrunk-to-base weight allocation
 *   • evaluateProfile        — confusion matrix + decision-margin metrics
 */

import type { CalibrationCase } from './competitorQualificationCalibration';
import {
  evaluateMultiSignalQualification,
  MULTISIGNAL_WEIGHT_PROFILE_V1,
  type MultiSignalQualification,
  type QualificationWeightProfile,
} from './competitorQualificationModel';
import type { QualificationSignalKey } from './competitorSignalExtraction';

export const SIGNAL_KEYS: QualificationSignalKey[] = [
  'semanticSimilarity',
  'productOverlap',
  'icpOverlap',
  'marketOverlap',
  'businessModelSimilarity',
  'serpEvidence',
  'taxonomyPrior',
];

const EVIDENCE_KEYS: QualificationSignalKey[] = SIGNAL_KEYS.filter((k) => k !== 'taxonomyPrior');

const round = (v: number, dp = 3): number => Number(v.toFixed(dp));

// ── Contribution decomposition ───────────────────────────────────────────────
export interface SignalContribution {
  key: QualificationSignalKey;
  value: number;
  coverage: number;
  baseWeight: number;
  effectiveWeight: number;
  /** Points of the final 0–100 score attributable to this signal. */
  contribution: number;
  /** Share of the final score contributed by this signal (0–1). */
  contributionShare: number;
}

export interface CaseDecomposition {
  id: string;
  industry: string;
  coverage: 'seen' | 'unseen';
  expectedCompetitor: boolean;
  score: number;
  decision: MultiSignalQualification['decision'];
  predictsCompetitor: boolean;
  correct: boolean;
  taxonomyCoverage: MultiSignalQualification['taxonomyCoverage'];
  contributions: SignalContribution[];
  dominantSignals: QualificationSignalKey[];
}

export function decomposeContributions(
  caseItem: CalibrationCase,
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
): CaseDecomposition {
  const q = evaluateMultiSignalQualification(caseItem.candidate, caseItem.context, profile);
  const totalEffective = SIGNAL_KEYS.reduce((sum, k) => sum + (q.effectiveWeights[k] ?? 0), 0);
  const contributions: SignalContribution[] = q.signals.map((s) => {
    const effectiveWeight = q.effectiveWeights[s.key] ?? 0;
    const share = totalEffective > 0 ? (effectiveWeight * s.value) / totalEffective : 0;
    return {
      key: s.key,
      value: round(s.value),
      coverage: round(s.coverage),
      baseWeight: profile.weights[s.key],
      effectiveWeight: round(effectiveWeight, 4),
      contribution: round(share * 100, 2),
      contributionShare: round(share, 4),
    };
  });
  const dominantSignals = [...contributions]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .filter((c) => c.contribution > 0)
    .map((c) => c.key);
  const predictsCompetitor = q.decision === 'qualified';
  return {
    id: caseItem.id,
    industry: caseItem.industry,
    coverage: caseItem.coverage,
    expectedCompetitor: caseItem.expectedCompetitor,
    score: q.score,
    decision: q.decision,
    predictsCompetitor,
    correct: predictsCompetitor === caseItem.expectedCompetitor,
    taxonomyCoverage: q.taxonomyCoverage,
    contributions,
    dominantSignals,
  };
}

// ── Signal discrimination ────────────────────────────────────────────────────
export interface SignalDiscrimination {
  key: QualificationSignalKey;
  baseWeight: number;
  meanValuePositive: number;
  meanValueNegative: number;
  /** value separation = mean(value|competitor) − mean(value|non-competitor); higher = better. */
  valueDelta: number;
  meanContributionPositive: number;
  meanContributionNegative: number;
  contributionDelta: number;
  coverageRate: number;
  /** valueDelta per unit of weight — discriminative efficiency of the weight spent. */
  efficiency: number;
}

export function signalDiscrimination(
  cases: CalibrationCase[],
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
): SignalDiscrimination[] {
  const decomps = cases.map((c) => ({ caseItem: c, d: decomposeContributions(c, profile) }));
  return SIGNAL_KEYS.map((key) => {
    const pos = decomps.filter((x) => x.caseItem.expectedCompetitor);
    const neg = decomps.filter((x) => !x.caseItem.expectedCompetitor);
    const pick = (rows: typeof decomps) => rows.map((r) => r.d.contributions.find((c) => c.key === key)!);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const posC = pick(pos);
    const negC = pick(neg);
    const meanValuePositive = mean(posC.map((c) => c.value));
    const meanValueNegative = mean(negC.map((c) => c.value));
    const valueDelta = meanValuePositive - meanValueNegative;
    const meanContributionPositive = mean(posC.map((c) => c.contribution));
    const meanContributionNegative = mean(negC.map((c) => c.contribution));
    const coverageRate = mean([...posC, ...negC].map((c) => (c.coverage > 0 ? 1 : 0)));
    const baseWeight = profile.weights[key];
    return {
      key,
      baseWeight,
      meanValuePositive: round(meanValuePositive),
      meanValueNegative: round(meanValueNegative),
      valueDelta: round(valueDelta),
      meanContributionPositive: round(meanContributionPositive, 2),
      meanContributionNegative: round(meanContributionNegative, 2),
      contributionDelta: round(meanContributionPositive - meanContributionNegative, 2),
      coverageRate: round(coverageRate),
      efficiency: round(baseWeight > 0 ? valueDelta / baseWeight : 0),
    };
  });
}

// ── Confusion matrix + margin metrics ────────────────────────────────────────
export interface ProfileEvaluation {
  profileId: string;
  total: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  accuracy: number;
  f1: number;
  // Margin metrics — decision robustness, not just correctness.
  minPositiveScore: number;
  maxNegativeScore: number;
  /** minPositiveScore − maxNegativeScore; larger ⇒ cleaner separation. */
  separationGap: number;
  meanPositiveScore: number;
  meanNegativeScore: number;
  /** minPositiveScore − qualifyThreshold; headroom of the weakest true competitor. */
  minPositiveMargin: number;
  /** qualifyThreshold − maxNegativeScore; headroom below threshold of the strongest non-competitor. */
  negativeHeadroom: number;
}

export function evaluateProfile(
  cases: CalibrationCase[],
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
): ProfileEvaluation {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const posScores: number[] = [];
  const negScores: number[] = [];
  for (const c of cases) {
    const q = evaluateMultiSignalQualification(c.candidate, c.context, profile);
    const predicts = q.decision === 'qualified';
    if (c.expectedCompetitor) posScores.push(q.score);
    else negScores.push(q.score);
    if (predicts && c.expectedCompetitor) tp += 1;
    else if (predicts && !c.expectedCompetitor) fp += 1;
    else if (!predicts && !c.expectedCompetitor) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const minPositiveScore = posScores.length ? Math.min(...posScores) : 0;
  const maxNegativeScore = negScores.length ? Math.max(...negScores) : 0;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    profileId: profile.id,
    total: cases.length,
    truePositive: tp,
    falsePositive: fp,
    trueNegative: tn,
    falseNegative: fn,
    precision: round(precision),
    recall: round(recall),
    falsePositiveRate: round(fp + tn > 0 ? fp / (fp + tn) : 0),
    accuracy: round((tp + tn) / cases.length),
    f1: round(precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0),
    minPositiveScore,
    maxNegativeScore,
    separationGap: minPositiveScore - maxNegativeScore,
    meanPositiveScore: round(mean(posScores), 1),
    meanNegativeScore: round(mean(negScores), 1),
    minPositiveMargin: minPositiveScore - profile.qualifyThreshold,
    negativeHeadroom: profile.qualifyThreshold - maxNegativeScore,
  };
}

// ── Sensitivity sweep ────────────────────────────────────────────────────────
export interface SensitivityPoint {
  key: QualificationSignalKey;
  deltaPct: number;
  perturbedWeight: number;
  decisionFlips: number;
  meanAbsScoreChange: number;
  maxAbsScoreChange: number;
  separationGap: number;
  accuracy: number;
}

export interface SignalStability {
  key: QualificationSignalKey;
  baseWeight: number;
  totalFlips: number;
  worstSeparationGap: number;
  maxScoreSwing: number;
  stable: boolean;
}

function scaleWeight(
  profile: QualificationWeightProfile,
  key: QualificationSignalKey,
  factor: number,
): QualificationWeightProfile {
  return {
    ...profile,
    id: `${profile.id}~${key}x${factor}`,
    weights: { ...profile.weights, [key]: Math.max(0, profile.weights[key] * factor) },
  };
}

export function sensitivitySweep(
  cases: CalibrationCase[],
  profile: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
  deltaPcts: number[] = [-20, -10, 10, 20],
): { points: SensitivityPoint[]; stability: SignalStability[] } {
  const baseline = cases.map((c) => evaluateMultiSignalQualification(c.candidate, c.context, profile));
  const points: SensitivityPoint[] = [];
  const stability: SignalStability[] = [];

  for (const key of SIGNAL_KEYS) {
    let totalFlips = 0;
    let worstGap = Number.POSITIVE_INFINITY;
    let maxSwing = 0;
    for (const deltaPct of deltaPcts) {
      const perturbed = scaleWeight(profile, key, 1 + deltaPct / 100);
      let flips = 0;
      let sumAbs = 0;
      let maxAbs = 0;
      const posScores: number[] = [];
      const negScores: number[] = [];
      let correct = 0;
      cases.forEach((c, i) => {
        const q = evaluateMultiSignalQualification(c.candidate, c.context, perturbed);
        const before = baseline[i];
        const beforePredicts = before.decision === 'qualified';
        const afterPredicts = q.decision === 'qualified';
        if (beforePredicts !== afterPredicts) flips += 1;
        const absChange = Math.abs(q.score - before.score);
        sumAbs += absChange;
        maxAbs = Math.max(maxAbs, absChange);
        if (c.expectedCompetitor) posScores.push(q.score);
        else negScores.push(q.score);
        if (afterPredicts === c.expectedCompetitor) correct += 1;
      });
      const gap = (posScores.length ? Math.min(...posScores) : 0) - (negScores.length ? Math.max(...negScores) : 0);
      points.push({
        key,
        deltaPct,
        perturbedWeight: round(perturbed.weights[key], 4),
        decisionFlips: flips,
        meanAbsScoreChange: round(sumAbs / cases.length, 2),
        maxAbsScoreChange: round(maxAbs, 2),
        separationGap: gap,
        accuracy: round(correct / cases.length),
      });
      totalFlips += flips;
      worstGap = Math.min(worstGap, gap);
      maxSwing = Math.max(maxSwing, maxAbs);
    }
    stability.push({
      key,
      baseWeight: profile.weights[key],
      totalFlips,
      worstSeparationGap: worstGap === Number.POSITIVE_INFINITY ? 0 : worstGap,
      maxScoreSwing: round(maxSwing, 2),
      stable: totalFlips === 0,
    });
  }
  return { points, stability };
}

// ── Deterministic optimizer ──────────────────────────────────────────────────
/**
 * Derive an optimized weight profile purely from measured discrimination — no hand-tuning.
 *
 * Method (documented, reproducible):
 *   1. Measure each signal's value-discrimination Δ = mean(value|pos) − mean(value|neg).
 *   2. Ideal evidence share ∝ max(0, Δ). This rewards signals that actually separate
 *      competitors from non-competitors and starves those that don't.
 *   3. Shrink toward the current base shares by λ (regularization) so a single dataset can't
 *      overfit the profile, then apply a per-signal FLOOR so no evidence signal is deleted
 *      (a signal with zero discrimination on THIS set — e.g. provenance held constant — must
 *      still carry weight for production variation).
 *   4. Taxonomy stays a BOUNDED PRIOR: its weight is capped at the base cap and never exceeds
 *      the smallest evidence weight, preserving the architectural invariant.
 */
export interface OptimizerParams {
  shrinkage: number; // λ in [0,1]; 0 = pure base, 1 = pure discrimination
  evidenceFloor: number;
  taxonomyCap: number;
}

export const DEFAULT_OPTIMIZER_PARAMS: OptimizerParams = {
  shrinkage: 0.5,
  evidenceFloor: 0.05,
  taxonomyCap: 0.1,
};

export function deriveOptimizedProfile(
  cases: CalibrationCase[],
  base: QualificationWeightProfile = MULTISIGNAL_WEIGHT_PROFILE_V1,
  params: OptimizerParams = DEFAULT_OPTIMIZER_PARAMS,
  id = 'multisignal-v2',
): QualificationWeightProfile {
  const disc = signalDiscrimination(cases, base);
  const discByKey = new Map(disc.map((d) => [d.key, d]));

  // Taxonomy: bounded. Keep it as a small prior, capped and not larger than base.
  const taxonomyWeight = Math.min(params.taxonomyCap, base.weights.taxonomyPrior);
  const evidenceBudget = 1 - taxonomyWeight;

  // Base evidence shares (renormalized within the evidence budget).
  const baseEvidenceTotal = EVIDENCE_KEYS.reduce((s, k) => s + base.weights[k], 0);
  const baseShare = (k: QualificationSignalKey) => base.weights[k] / baseEvidenceTotal;

  // Discrimination shares.
  const tilt = (k: QualificationSignalKey) => Math.max(0, discByKey.get(k)?.valueDelta ?? 0);
  const tiltTotal = EVIDENCE_KEYS.reduce((s, k) => s + tilt(k), 0) || 1;
  const tiltShare = (k: QualificationSignalKey) => tilt(k) / tiltTotal;

  // Shrink discrimination toward base, then floor and renormalize to the evidence budget.
  let raw: Record<string, number> = {};
  for (const k of EVIDENCE_KEYS) {
    raw[k] = (1 - params.shrinkage) * baseShare(k) + params.shrinkage * tiltShare(k);
  }
  // Apply floor (as a share of the evidence budget), then renormalize shares to sum to 1.
  const floorShare = params.evidenceFloor / evidenceBudget;
  for (const k of EVIDENCE_KEYS) raw[k] = Math.max(raw[k], floorShare);
  const rawTotal = EVIDENCE_KEYS.reduce((s, k) => s + raw[k], 0);
  const weights = {} as Record<QualificationSignalKey, number>;
  for (const k of EVIDENCE_KEYS) weights[k] = round((raw[k] / rawTotal) * evidenceBudget, 2);
  weights.taxonomyPrior = round(taxonomyWeight, 2);

  // Fix rounding drift on the largest evidence signal so weights sum to exactly 1.00.
  const sum = SIGNAL_KEYS.reduce((s, k) => s + weights[k], 0);
  const drift = round(1 - sum, 2);
  if (drift !== 0) {
    const largest = EVIDENCE_KEYS.reduce((a, b) => (weights[a] >= weights[b] ? a : b));
    weights[largest] = round(weights[largest] + drift, 2);
  }

  return {
    id,
    weights,
    qualifyThreshold: base.qualifyThreshold,
    borderlineThreshold: base.borderlineThreshold,
  };
}
