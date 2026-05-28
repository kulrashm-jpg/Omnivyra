/**
 * Phase 9 — Revision governance explanation composer.
 *
 * Single canonical reasoning source → same hash for same state.
 */

import type {
  ApprovalReadinessResult,
  CollaborativeConflictResult,
  EditorialDiffAnalysis,
  EditorialIntentPreservationResult,
  HumanAIDriftResult,
  RevisionAwareValidationResult,
  RevisionGovernanceExplanation,
  RevisionRecoveryPlan,
} from './longFormRecommendationTypes';
import { aggregateEditRiskAcrossRevisions } from './editorialDiffAnalyzer';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface ComposeRevisionGovernanceExplanationInput {
  diffAnalyses: EditorialDiffAnalysis[];
  intentPreservation: EditorialIntentPreservationResult;
  drift: HumanAIDriftResult;
  approval: ApprovalReadinessResult;
  conflicts: CollaborativeConflictResult;
  recoveryPlan: RevisionRecoveryPlan;
  revisionValidations: RevisionAwareValidationResult[];
}

export function composeRevisionGovernanceExplanation(
  input: ComposeRevisionGovernanceExplanationInput,
): RevisionGovernanceExplanation {
  const agg = aggregateEditRiskAcrossRevisions(input.diffAnalyses);
  const driftedDims = input.intentPreservation.dimensions.filter((d) => d.drifted).map((d) => d.dimension);
  const survivedDims = input.intentPreservation.dimensions.filter((d) => !d.drifted).map((d) => d.dimension);

  const canonical = {
    avgEditRisk: agg.averageEditRiskScore,
    topRiskTypes: agg.topRiskTypes,
    totalDetections: agg.totalDetections,
    intentScore: input.intentPreservation.overallPreservationScore,
    driftedDims,
    survivedDims,
    fragmentation: input.intentPreservation.fragmentationDetected,
    divergence: input.intentPreservation.divergenceDetected,
    humanDriftCount: input.drift.humanDriftIndicators.length,
    aiDriftCount: input.drift.aiDriftIndicators.length,
    approvalScore: input.approval.approvalReadinessScore,
    approvalState: input.approval.approvalState,
    blockerCount: input.approval.approvalBlockers.length,
    recommendedReviewers: input.approval.recommendedReviewers,
    conflictCount: input.conflicts.conflicts.length,
    conflictSeverity: input.conflicts.conflictSeverity,
    recoveryActions: input.recoveryPlan.steps.map((s) => s.action),
    validatedRevisionCount: input.revisionValidations.length,
  };

  const whatChanged = canonical.totalDetections === 0
    ? `${canonical.validatedRevisionCount} revision(s) made no detectable risky changes.`
    : `${canonical.validatedRevisionCount} revision(s) produced ${canonical.totalDetections} risk detection(s); top types: ${canonical.topRiskTypes.join(', ') || 'n/a'}.`;

  const whichRisksIncreased = canonical.avgEditRisk === 0
    ? 'Edit risk remained negligible across revisions.'
    : `Average edit risk score: ${canonical.avgEditRisk}/100. Human drift indicators: ${canonical.humanDriftCount}; AI drift indicators: ${canonical.aiDriftCount}.`;

  const whichProtectionsWeakened = canonical.driftedDims.length === 0
    ? 'No intent dimensions drifted past the threshold.'
    : `${canonical.driftedDims.length} drifted intent dimension(s): ${canonical.driftedDims.join(', ')}.`;

  const whichContinuitySurvived = canonical.survivedDims.length === 0
    ? 'No intent dimensions confirmed preserved.'
    : `${canonical.survivedDims.length}/${canonical.driftedDims.length + canonical.survivedDims.length} intent dimension(s) preserved (${canonical.survivedDims.slice(0, 4).join(', ')}${canonical.survivedDims.length > 4 ? '…' : ''}).`;

  const whichReviewersAreRequired = canonical.recommendedReviewers.length === 0
    ? 'No specific reviewer escalation required.'
    : `Recommended reviewers: ${canonical.recommendedReviewers.join(', ')}. Approval state: ${canonical.approvalState} (${canonical.blockerCount} blocker(s)).`;

  const whatRecoveryIsRecommended = canonical.recoveryActions.length === 0
    ? 'No recovery actions recommended.'
    : `${canonical.recoveryActions.length} recovery action(s): ${Array.from(new Set(canonical.recoveryActions)).join('; ')}.`;

  return {
    whatChanged,
    whichRisksIncreased,
    whichProtectionsWeakened,
    whichContinuitySurvived,
    whichReviewersAreRequired,
    whatRecoveryIsRecommended,
    reasoningSourceHash: `rge_${stableHash(JSON.stringify(canonical))}`,
  };
}
