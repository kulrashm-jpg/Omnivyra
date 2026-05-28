/**
 * Phase 6 — Generation preparation explanation composer.
 *
 * Single canonical reasoning source for the orchestration decision. Every
 * section reads from the same `canonical` object so the composer cannot
 * produce contradictory explanations.
 *
 * Output:
 *   whyApproved | whyBlocked        — mutually exclusive
 *   whatContinuitySurvived          — best-preserved dimensions
 *   whatDegraded                    — failing/borderline dimensions
 *   whatStrategicIntentRemains      — strategic narrative status
 *   whatOperationalDepthRemains     — operational logic / proof status
 *   recoveryGuidance                — top recovery step (or "none" if approved)
 *   reasoningSourceHash             — stable hash for caching/correlation
 */

import type {
  GenerationGateDecision,
  GenerationOrchestrationContract,
  GenerationPreparationExplanation,
  GenerationReadinessAssessment,
  PlannerGenerationContinuityResult,
  RecoveryAttemptPlan,
  RecoveryRecommendationItem,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function topDims(
  scores: GenerationReadinessAssessment['dimensionScores'],
  n: number,
): Array<[string, number]> {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function bottomDims(
  scores: GenerationReadinessAssessment['dimensionScores'],
  n: number,
): Array<[string, number]> {
  return Object.entries(scores).sort((a, b) => a[1] - b[1]).slice(0, n);
}

export interface ComposePreparationExplanationInput {
  contract: GenerationOrchestrationContract;
  readiness: GenerationReadinessAssessment;
  gate: GenerationGateDecision;
  plannerContinuity: PlannerGenerationContinuityResult;
  recoveryRecommendations: RecoveryRecommendationItem[];
  recoveryAttemptPlan: RecoveryAttemptPlan;
}

export function composeGenerationPreparationExplanation(
  input: ComposePreparationExplanationInput,
): GenerationPreparationExplanation {
  const canonical = {
    decision: input.gate.decision,
    band: input.readiness.readinessBand,
    score: input.readiness.generationReadinessScore,
    contractId: input.contract.generationContractId,
    lineageId: input.contract.generationLineageId,
    archetype: input.contract.narrativeArchetype ?? 'uncategorized',
    primaryUse: input.contract.recommendedPrimaryUse ?? 'unknown',
    plannerContinuityScore: input.plannerContinuity.plannerGenerationContinuityScore,
    plannerPreserved: input.plannerContinuity.preserved,
    plannerDetections: input.plannerContinuity.detections.map((d) => ({ type: d.type, severity: d.severity })),
    failingDimensions: input.readiness.failingDimensions.map((d) => ({ dim: String(d.dimension), score: d.score })),
    blockReasons: input.gate.generationBlockReasons.map((r) => ({ dim: r.dimension, severity: r.severity })),
    topPreserved: topDims(input.readiness.dimensionScores, 3),
    bottomPreserved: bottomDims(input.readiness.dimensionScores, 3),
    upstream: input.contract.upstreamScoreSnapshot,
    nextRecovery: input.recoveryAttemptPlan.attempts[0]?.strategy ?? null,
    recoveryCost: input.recoveryAttemptPlan.totalEstimatedCost,
    fallbackToFullPipeline: input.recoveryAttemptPlan.fallbackToFullPipeline,
  };

  const whyApproved = canonical.decision !== 'block'
    ? `Approved at ${canonical.band} readiness (${canonical.score}). Planner→generation continuity ${canonical.plannerContinuityScore}; top-preserved dimensions: ${canonical.topPreserved.map(([d, v]) => `${d} (${v})`).join(', ')}.`
    : null;

  const whyBlocked = canonical.decision === 'block'
    ? `Blocked at ${canonical.band} readiness (${canonical.score}). ${canonical.blockReasons.length} block reason(s): ${canonical.blockReasons.map((r) => `${r.dim} [${r.severity}]`).join(', ')}.`
    : null;

  const whatContinuitySurvived = `Best-preserved: ${canonical.topPreserved.map(([d, v]) => `${d} (${v})`).join('; ')}. Planner→generation continuity ${canonical.plannerContinuityScore}/100.`;

  const whatDegraded = canonical.failingDimensions.length === 0
    ? 'No dimensions below their minimum floors.'
    : `Failing dimensions: ${canonical.failingDimensions.map((d) => `${d.dim} (${d.score})`).join('; ')}. Detections: ${canonical.plannerDetections.length === 0 ? 'none' : canonical.plannerDetections.map((d) => `${d.type}/${d.severity}`).join(', ')}.`;

  const whatStrategicIntentRemains = (() => {
    const strat = canonical.plannerPreserved.strategicSequencing;
    const editorial = canonical.plannerPreserved.editorialIntent;
    if (strat >= 70 && editorial >= 70) {
      return `Strategic intent intact: sequencing ${strat}, editorial ${editorial}. Archetype ${canonical.archetype} preserved.`;
    }
    if (strat < 50 || editorial < 50) {
      return `Strategic intent weakened: sequencing ${strat}, editorial ${editorial}. ${canonical.plannerDetections.some((d) => d.type === 'NARRATIVE_FLATTENING') ? 'Narrative flattening detected.' : ''}`;
    }
    return `Strategic intent partially preserved: sequencing ${strat}, editorial ${editorial}.`;
  })();

  const whatOperationalDepthRemains = (() => {
    const op = canonical.plannerPreserved.operationalLogic;
    const cap = canonical.plannerPreserved.capabilityEmphasis;
    const upstreamOp = canonical.upstream.operationalDepthScore;
    if (op >= 70 && cap >= 70) {
      return `Operational depth intact: planner-side ${op}, capability emphasis ${cap}, recommendation operational depth ${upstreamOp}.`;
    }
    if (op < 50 || cap < 50) {
      return `Operational depth weakened: planner-side ${op}, capability emphasis ${cap}. Recommendation operational depth ${upstreamOp} could not be carried into the plan.`;
    }
    return `Operational depth partially preserved: planner-side ${op}, capability emphasis ${cap}.`;
  })();

  const recoveryGuidance = canonical.decision === 'execute'
    ? 'No recovery required. Proceed to generation.'
    : input.recoveryAttemptPlan.attempts.length === 0
      ? 'No actionable recovery path (no failing dimensions matched recovery strategies). Consider manual review.'
      : `Recommend ${input.recoveryAttemptPlan.attempts.length} recovery step(s) starting with ${canonical.nextRecovery} (total cost: ${canonical.recoveryCost}${canonical.fallbackToFullPipeline ? '; full pipeline fallback may be required' : ''}).`;

  const reasoningSourceHash = `gpe_${stableHash(JSON.stringify(canonical))}`;

  return {
    whyApproved,
    whyBlocked,
    whatContinuitySurvived,
    whatDegraded,
    whatStrategicIntentRemains,
    whatOperationalDepthRemains,
    recoveryGuidance,
    reasoningSourceHash,
  };
}
