import type { ValidatorAcceptanceSimulation, SectionAcceptanceSimulation } from './validatorAcceptanceSimulation';
import type { ValidatorDecisionPreparation } from './validatorDecisionPreparation';
import type { ValidatorExecutionManifest } from './validatorExecutionManifest';
import type { ValidatorResultContractReport } from './validatorResultContracts';
import type { ValidatorReviewSequence } from './validatorReviewSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RecoveryDecisionReadiness = 'ready' | 'conditional' | 'blocked';
export type RecoveryDecisionConfidence = 'low' | 'medium' | 'high';

export interface SectionRecoveryDecisionPlan {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  recoveryDecisionEligibility: SectionAcceptanceSimulation['simulatedAcceptanceEligibility'];
  recoveryDecisionPriority: 'high' | 'medium' | 'low';
  dependencySignals: readonly string[];
  preservationSignals: readonly string[];
  boundarySignals: readonly string[];
  deferralSignals: readonly string[];
}

export interface ValidatorRecoveryDecisionSequence {
  version: 'validator-recovery-decision-sequencer-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRecoveryDecisionReadiness: RecoveryDecisionReadiness;
  recoveryDecisionSequence: readonly number[];
  recoveryDependencyOrdering: readonly string[];
  recoveryPriorityOrdering: readonly number[];
  recoveryDeferralOrdering: readonly number[];
  sectionRecoveryDecisionPlans: readonly SectionRecoveryDecisionPlan[];
  recoveryDecisionRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  recoveryDecisionConfidence: RecoveryDecisionConfidence;
}

export interface ValidatorRecoveryDecisionSequencerInput {
  validatorAcceptanceSimulation: ValidatorAcceptanceSimulation;
  validatorDecisionPreparation: ValidatorDecisionPreparation;
  validatorResultContracts: ValidatorResultContractReport;
  validatorReviewSequence: ValidatorReviewSequence;
  validatorExecutionManifest: ValidatorExecutionManifest;
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

function readiness(input: ValidatorRecoveryDecisionSequencerInput): RecoveryDecisionReadiness {
  if (
    input.validatorAcceptanceSimulation.overallAcceptanceSimulationReadiness === 'blocked'
    || input.validatorResultContracts.overallValidatorResultReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorAcceptanceSimulation.overallAcceptanceSimulationReadiness === 'conditional'
    || input.validatorResultContracts.overallValidatorResultReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: RecoveryDecisionReadiness, input: ValidatorRecoveryDecisionSequencerInput): RecoveryDecisionConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'high'
    && input.validatorResultContracts.validatorResultConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'low'
    || input.validatorResultContracts.validatorResultConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function decisionPreparationFor(input: ValidatorRecoveryDecisionSequencerInput, sectionIndex: number) {
  return input.validatorDecisionPreparation.sectionDecisionPreparation.find((section) => section.sectionIndex === sectionIndex);
}

function resultContractFor(input: ValidatorRecoveryDecisionSequencerInput, sectionIndex: number) {
  return input.validatorResultContracts.sectionValidatorResultContracts.find((section) => section.sectionIndex === sectionIndex);
}

function decisionPriority(section: SectionAcceptanceSimulation): SectionRecoveryDecisionPlan['recoveryDecisionPriority'] {
  if (section.simulatedAcceptanceEligibility === 'not_recommended') return 'low';
  if (section.simulatedRisks.length > 0 || section.simulatedAcceptanceEligibility === 'deferred') return 'medium';
  return 'high';
}

function sectionPlan(
  input: ValidatorRecoveryDecisionSequencerInput,
  section: SectionAcceptanceSimulation,
): SectionRecoveryDecisionPlan {
  const preparation = decisionPreparationFor(input, section.sectionIndex);
  const resultContract = resultContractFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    recoveryDecisionEligibility: section.simulatedAcceptanceEligibility,
    recoveryDecisionPriority: decisionPriority(section),
    dependencySignals: unique([
      ...section.simulatedDependencies,
      ...(preparation?.dependencySignals || []),
    ], 10),
    preservationSignals: unique([
      ...section.preservationExpectations,
      ...(resultContract?.resultPreservationRequirements || []),
    ], 10),
    boundarySignals: unique([
      ...(preparation?.boundarySignals || []),
      ...(resultContract?.resultBoundaries || []),
    ], 10),
    deferralSignals: unique(section.simulatedDeferrals, 8),
  };
}

export function sequenceValidatorRecoveryDecision(input: ValidatorRecoveryDecisionSequencerInput): ValidatorRecoveryDecisionSequence {
  const orderedSimulations = input.validatorReviewSequence.reviewSequenceOrder
    .map((sectionIndex) => input.validatorAcceptanceSimulation.sectionAcceptanceSimulations.find((section) => section.sectionIndex === sectionIndex))
    .filter((section): section is SectionAcceptanceSimulation => Boolean(section));
  const sectionRecoveryDecisionPlans = orderedSimulations.map((section) => sectionPlan(input, section));
  const recoveryPriorityOrdering = [...sectionRecoveryDecisionPlans]
    .sort((a, b) => {
      const weight = { high: 0, medium: 1, low: 2 };
      return weight[a.recoveryDecisionPriority] - weight[b.recoveryDecisionPriority]
        || input.validatorReviewSequence.reviewSequenceOrder.indexOf(a.sectionIndex) - input.validatorReviewSequence.reviewSequenceOrder.indexOf(b.sectionIndex);
    })
    .map((section) => section.sectionIndex);
  const overallRecoveryDecisionReadiness = readiness(input);

  return {
    version: 'validator-recovery-decision-sequencer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorAcceptanceSimulation.contentType,
    topic: input.validatorAcceptanceSimulation.topic,
    overallRecoveryDecisionReadiness,
    recoveryDecisionSequence: sectionRecoveryDecisionPlans.map((section) => section.sectionIndex),
    recoveryDependencyOrdering: unique([
      ...input.validatorAcceptanceSimulation.simulatedAcceptanceDependencies,
      ...input.validatorReviewSequence.reviewDependencyOrdering,
    ], 18),
    recoveryPriorityOrdering,
    recoveryDeferralOrdering: unique([
      ...input.validatorAcceptanceSimulation.simulatedAcceptanceDeferrals.map(String),
      ...input.validatorExecutionManifest.validatorDeferredTargets.map(String),
    ]).map(Number),
    sectionRecoveryDecisionPlans,
    recoveryDecisionRiskProfile: {
      lowRisk: input.validatorAcceptanceSimulation.acceptanceSimulationRiskProfile.lowRisk,
      mediumRisk: input.validatorAcceptanceSimulation.acceptanceSimulationRiskProfile.mediumRisk,
      highRisk: input.validatorAcceptanceSimulation.acceptanceSimulationRiskProfile.highRisk,
      gaps: input.validatorAcceptanceSimulation.acceptanceSimulationRiskProfile.gaps,
      deferred: input.validatorAcceptanceSimulation.acceptanceSimulationRiskProfile.deferred,
    },
    recoveryDecisionConfidence: confidence(overallRecoveryDecisionReadiness, input),
  };
}

export function serializeValidatorRecoveryDecisionSequence(sequence: ValidatorRecoveryDecisionSequence): string {
  return [
    '## VALIDATOR RECOVERY DECISION SEQUENCE',
    `Version: ${sequence.version}`,
    `Topic: ${sequence.topic}`,
    `Content type: ${sequence.contentType}`,
    `Recovery decision readiness: ${sequence.overallRecoveryDecisionReadiness}`,
    `Recovery decision confidence: ${sequence.recoveryDecisionConfidence}`,
    `Decision sequence: ${sequence.recoveryDecisionSequence.join(', ') || 'none'}`,
    `Priority order: ${sequence.recoveryPriorityOrdering.join(', ') || 'none'}`,
    `Deferral order: ${sequence.recoveryDeferralOrdering.join(', ') || 'none'}`,
  ].join('\n');
}
