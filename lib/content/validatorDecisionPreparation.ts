import type { AcceptanceReviewPackage } from './acceptanceReviewPackageAssembler';
import type { ValidatorExecutionManifest } from './validatorExecutionManifest';
import type { ValidatorReadinessObservation } from './validatorReadinessObserver';
import type { ValidatorResultContractReport, SectionValidatorResultContract } from './validatorResultContracts';
import type { ValidatorReviewSequence } from './validatorReviewSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type DecisionPreparationReadiness = 'ready' | 'conditional' | 'blocked';
export type DecisionPreparationConfidence = 'low' | 'medium' | 'high';

export interface SectionDecisionPreparation {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  decisionEligibility: SectionValidatorResultContract['resultEligibility'];
  decisionSignals: readonly string[];
  dependencySignals: readonly string[];
  boundarySignals: readonly string[];
  preservationSignals: readonly string[];
  riskSignals: readonly string[];
}

export interface ValidatorDecisionPreparation {
  version: 'validator-decision-preparation-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallDecisionPreparationReadiness: DecisionPreparationReadiness;
  decisionPreparationSignals: readonly string[];
  decisionDependencySignals: readonly string[];
  decisionBoundarySignals: readonly string[];
  decisionPreservationSignals: readonly string[];
  decisionRiskSignals: readonly string[];
  sectionDecisionPreparation: readonly SectionDecisionPreparation[];
  decisionPreparationConfidence: DecisionPreparationConfidence;
}

export interface ValidatorDecisionPreparationInput {
  validatorResultContracts: ValidatorResultContractReport;
  validatorReviewSequence: ValidatorReviewSequence;
  validatorExecutionManifest: ValidatorExecutionManifest;
  validatorReadinessObservation: ValidatorReadinessObservation;
  acceptanceReviewPackage: AcceptanceReviewPackage;
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

function readiness(input: ValidatorDecisionPreparationInput): DecisionPreparationReadiness {
  if (
    input.validatorResultContracts.overallValidatorResultReadiness === 'blocked'
    || input.validatorReviewSequence.overallReviewSequenceReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorResultContracts.overallValidatorResultReadiness === 'conditional'
    || input.validatorReviewSequence.overallReviewSequenceReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: DecisionPreparationReadiness, input: ValidatorDecisionPreparationInput): DecisionPreparationConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorResultContracts.validatorResultConfidence === 'high'
    && input.validatorReviewSequence.reviewSequenceConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorResultContracts.validatorResultConfidence === 'low'
    || input.validatorReviewSequence.reviewSequenceConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sequencePlanFor(input: ValidatorDecisionPreparationInput, sectionIndex: number) {
  return input.validatorReviewSequence.sectionReviewSequencePlans.find((section) => section.sectionIndex === sectionIndex);
}

function sectionDecision(input: ValidatorDecisionPreparationInput, section: SectionValidatorResultContract): SectionDecisionPreparation {
  const sequencePlan = sequencePlanFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    decisionEligibility: section.resultEligibility,
    decisionSignals: unique([
      `prepare validator decision for section ${section.sectionIndex}`,
      `result eligibility: ${section.resultEligibility}`,
      ...section.resultRequirements,
    ], 10),
    dependencySignals: unique(sequencePlan?.dependencySignals || [], 10),
    boundarySignals: unique([
      ...section.resultBoundaries,
      ...(sequencePlan?.boundarySignals || []),
    ], 10),
    preservationSignals: unique([
      ...section.resultPreservationRequirements,
      ...(sequencePlan?.preservationSignals || []),
    ], 10),
    riskSignals: unique([
      ...(sequencePlan?.deferralSignals || []),
      ...(section.resultEligibility === 'eligible' ? [] : [`decision deferred by eligibility: ${section.resultEligibility}`]),
    ], 8),
  };
}

export function prepareValidatorDecision(input: ValidatorDecisionPreparationInput): ValidatorDecisionPreparation {
  const overallDecisionPreparationReadiness = readiness(input);
  const sectionDecisionPreparation = input.validatorResultContracts.sectionValidatorResultContracts.map((section) => sectionDecision(input, section));

  return {
    version: 'validator-decision-preparation-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorResultContracts.contentType,
    topic: input.validatorResultContracts.topic,
    overallDecisionPreparationReadiness,
    decisionPreparationSignals: unique([
      `validator result readiness: ${input.validatorResultContracts.overallValidatorResultReadiness}`,
      `review sequence readiness: ${input.validatorReviewSequence.overallReviewSequenceReadiness}`,
      `execution readiness: ${input.validatorExecutionManifest.overallValidatorExecutionReadiness}`,
      `acceptance package readiness: ${input.acceptanceReviewPackage.overallAcceptancePackageReadiness}`,
    ], 10),
    decisionDependencySignals: unique(input.validatorReviewSequence.reviewDependencyOrdering, 18),
    decisionBoundarySignals: unique(input.validatorResultContracts.validatorResultBoundaries, 16),
    decisionPreservationSignals: unique(input.validatorResultContracts.validatorResultPreservationRequirements, 16),
    decisionRiskSignals: unique([
      ...input.validatorReadinessObservation.validatorGapSignals,
      ...input.validatorReviewSequence.reviewDeferralOrdering.map((sectionIndex) => `deferred section: ${sectionIndex}`),
    ], 16),
    sectionDecisionPreparation,
    decisionPreparationConfidence: confidence(overallDecisionPreparationReadiness, input),
  };
}

export function serializeValidatorDecisionPreparation(preparation: ValidatorDecisionPreparation): string {
  return [
    '## VALIDATOR DECISION PREPARATION',
    `Version: ${preparation.version}`,
    `Topic: ${preparation.topic}`,
    `Content type: ${preparation.contentType}`,
    `Decision readiness: ${preparation.overallDecisionPreparationReadiness}`,
    `Decision confidence: ${preparation.decisionPreparationConfidence}`,
    `Section decisions: ${preparation.sectionDecisionPreparation.length}`,
    `Boundary signals: ${preparation.decisionBoundarySignals.length}`,
    `Preservation signals: ${preparation.decisionPreservationSignals.length}`,
  ].join('\n');
}
