import type { AcceptanceReadinessContractReport } from './acceptanceReadinessContracts';
import type { AcceptanceReviewPackage } from './acceptanceReviewPackageAssembler';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { ValidatorExecutionManifest, SectionValidatorExecutionPayload } from './validatorExecutionManifest';
import type { ValidatorReadinessObservation } from './validatorReadinessObserver';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ReviewSequenceReadiness = 'ready' | 'conditional' | 'blocked';
export type ReviewSequenceConfidence = 'low' | 'medium' | 'high';

export interface SectionReviewSequencePlan {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  sequencePosition: number;
  reviewPriority: 'high' | 'medium' | 'low';
  dependencySignals: readonly string[];
  boundarySignals: readonly string[];
  preservationSignals: readonly string[];
  deferralSignals: readonly string[];
}

export interface ValidatorReviewSequence {
  version: 'validator-review-sequencer-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallReviewSequenceReadiness: ReviewSequenceReadiness;
  reviewSequenceOrder: readonly number[];
  reviewDependencyOrdering: readonly string[];
  reviewPriorityOrdering: readonly number[];
  reviewDeferralOrdering: readonly number[];
  sectionReviewSequencePlans: readonly SectionReviewSequencePlan[];
  reviewSequenceRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  reviewSequenceConfidence: ReviewSequenceConfidence;
}

export interface ValidatorReviewSequencerInput {
  validatorExecutionManifest: ValidatorExecutionManifest;
  validatorReadinessObservation: ValidatorReadinessObservation;
  acceptanceReviewPackage: AcceptanceReviewPackage;
  acceptanceReadinessContracts: AcceptanceReadinessContractReport;
  recoveryExecutionDryRun: RecoveryExecutionDryRunPlan;
}

function unique(values: readonly string[], limit = 16): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function readiness(input: ValidatorReviewSequencerInput): ReviewSequenceReadiness {
  if (
    input.validatorExecutionManifest.overallValidatorExecutionReadiness === 'blocked'
    || input.validatorReadinessObservation.overallValidatorReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorExecutionManifest.overallValidatorExecutionReadiness === 'conditional'
    || input.validatorReadinessObservation.overallValidatorReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ReviewSequenceReadiness, input: ValidatorReviewSequencerInput): ReviewSequenceConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorExecutionManifest.validatorExecutionConfidence === 'high'
    && input.validatorReadinessObservation.validatorReadinessConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorExecutionManifest.validatorExecutionConfidence === 'low'
    || input.validatorReadinessObservation.validatorReadinessConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function priority(payload: SectionValidatorExecutionPayload): SectionReviewSequencePlan['reviewPriority'] {
  if (payload.executionEligibility !== 'eligible') return 'low';
  if (payload.verificationChecks.length > 4 || payload.executionBoundaries.length > 3) return 'high';
  return 'medium';
}

function sequencePlan(payload: SectionValidatorExecutionPayload, index: number): SectionReviewSequencePlan {
  return {
    sectionIndex: payload.sectionIndex,
    progressionStage: payload.progressionStage,
    narrativeRole: payload.narrativeRole,
    sequencePosition: index,
    reviewPriority: priority(payload),
    dependencySignals: unique(payload.executionConstraints, 10),
    boundarySignals: unique(payload.executionBoundaries, 10),
    preservationSignals: unique(payload.preservationChecks, 10),
    deferralSignals: payload.executionEligibility === 'eligible'
      ? []
      : unique([`defer validator review until acceptance eligibility is ${payload.executionEligibility}`], 4),
  };
}

export function sequenceValidatorReview(input: ValidatorReviewSequencerInput): ValidatorReviewSequence {
  const orderedPayloads = input.validatorExecutionManifest.validatorExecutionOrder
    .map((sectionIndex) => input.validatorExecutionManifest.sectionValidatorExecutionPayloads.find((section) => section.sectionIndex === sectionIndex))
    .filter((section): section is SectionValidatorExecutionPayload => Boolean(section));
  const sectionReviewSequencePlans = orderedPayloads.map(sequencePlan);
  const reviewPriorityOrdering = sectionReviewSequencePlans
    .filter((section) => section.reviewPriority !== 'low')
    .sort((a, b) => {
      const weight = { high: 0, medium: 1, low: 2 };
      return weight[a.reviewPriority] - weight[b.reviewPriority] || a.sequencePosition - b.sequencePosition;
    })
    .map((section) => section.sectionIndex);
  const overallReviewSequenceReadiness = readiness(input);

  return {
    version: 'validator-review-sequencer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorExecutionManifest.contentType,
    topic: input.validatorExecutionManifest.topic,
    overallReviewSequenceReadiness,
    reviewSequenceOrder: sectionReviewSequencePlans.map((section) => section.sectionIndex),
    reviewDependencyOrdering: unique([
      ...input.validatorReadinessObservation.validatorDependencySignals,
      ...input.recoveryExecutionDryRun.rewriteDependencySignals,
    ], 18),
    reviewPriorityOrdering,
    reviewDeferralOrdering: input.validatorExecutionManifest.validatorDeferredTargets,
    sectionReviewSequencePlans,
    reviewSequenceRiskProfile: {
      lowRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.lowRisk,
      mediumRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.mediumRisk,
      highRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.highRisk,
      gaps: input.validatorReadinessObservation.validatorGapSignals.length,
      deferred: input.validatorExecutionManifest.validatorDeferredTargets.length,
    },
    reviewSequenceConfidence: confidence(overallReviewSequenceReadiness, input),
  };
}

export function serializeValidatorReviewSequence(sequence: ValidatorReviewSequence): string {
  return [
    '## VALIDATOR REVIEW SEQUENCE',
    `Version: ${sequence.version}`,
    `Topic: ${sequence.topic}`,
    `Content type: ${sequence.contentType}`,
    `Review sequence readiness: ${sequence.overallReviewSequenceReadiness}`,
    `Review sequence confidence: ${sequence.reviewSequenceConfidence}`,
    `Review order: ${sequence.reviewSequenceOrder.join(', ') || 'none'}`,
    `Priority order: ${sequence.reviewPriorityOrdering.join(', ') || 'none'}`,
    `Deferral order: ${sequence.reviewDeferralOrdering.join(', ') || 'none'}`,
  ].join('\n');
}
