/**
 * Phase 11 — Factual integrity explanation composer.
 *
 * Single canonical source; same recommendation+result → same hash.
 */

import type {
  FactualIntegrityExplanation,
  FactualRecoveryPlan,
  PostGenerationFactualResult,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface ComposeFactualIntegrityExplanationInput {
  factual: PostGenerationFactualResult;
  recoveryActionsApplied: FactualRecoveryPlan['steps'];
  softenedClaimsCount: number;
  removedFabricationsCount: number;
}

export function composeFactualIntegrityExplanation(
  input: ComposeFactualIntegrityExplanationInput,
): FactualIntegrityExplanation {
  const canonical = {
    score: input.factual.factualIntegrityScore,
    band: input.factual.hallucinationRiskBand,
    dim: input.factual.dimensionScores,
    unsupportedCount: input.factual.unsupportedClaims.length,
    unsupportedSample: input.factual.unsupportedClaims.slice(0, 3).map((c) => ({ id: c.claimId, action: c.recommendedAction })),
    warnings: input.factual.evidenceWarnings,
    trustWarnings: input.factual.trustCalibrationWarnings,
    recoveryActions: input.recoveryActionsApplied.map((s) => s.action),
    softened: input.softenedClaimsCount,
    removed: input.removedFabricationsCount,
  };

  const passed = input.factual.hallucinationRiskBand === 'minimal'
    || input.factual.hallucinationRiskBand === 'low'
    || (input.factual.hallucinationRiskBand === 'moderate' && canonical.unsupportedCount === 0);

  const whyPassed = passed
    ? `Article passed factual governance: integrity ${canonical.score}, hallucination risk ${canonical.band}. Evidence coverage ${canonical.dim.evidenceCoverage}; operational realism ${canonical.dim.operationalRealism}; authority calibration ${canonical.dim.authorityCalibration}.`
    : null;

  const whyFailed = !passed
    ? `Article did not pass: integrity ${canonical.score}, hallucination risk ${canonical.band}. ${canonical.unsupportedCount} unsupported claim(s); ${canonical.warnings.length} evidence warning(s).`
    : null;

  const whereUnsupportedClaimsExisted = canonical.unsupportedCount === 0
    ? 'No unsupported high-risk claims detected.'
    : `${canonical.unsupportedCount} unsupported claim(s). Sample remediations: ${canonical.unsupportedSample.map((s) => `${s.id}→${s.action}`).join('; ')}.`;

  const whereConfidenceWasSoftened = canonical.softened === 0
    ? 'No claims required certainty softening.'
    : `${canonical.softened} claim(s) softened via "soften_certainty" or "convert_to_inference_framing" actions during recovery.`;

  const whereEvidenceRisksRemain = canonical.warnings.length === 0
    ? 'No remaining evidence warnings.'
    : `${canonical.warnings.length} evidence warning(s) remain: ${canonical.warnings.slice(0, 2).join(' | ')}`;

  const whereHallucinationPressureWasReduced = canonical.removed === 0
    ? 'No fabricated statistics or benchmarks were stripped.'
    : `${canonical.removed} fabrication(s) removed across the recovery loop.`;

  return {
    whyPassed,
    whyFailed,
    whereUnsupportedClaimsExisted,
    whereConfidenceWasSoftened,
    whereEvidenceRisksRemain,
    whereHallucinationPressureWasReduced,
    reasoningSourceHash: `fie_${stableHash(JSON.stringify(canonical))}`,
  };
}
