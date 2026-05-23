import type { AcceptanceReviewPackage } from './acceptanceReviewPackageAssembler';
import type { ExecutorVerificationContractReport } from './executorVerificationContracts';
import type { ValidatorExecutionManifest, SectionValidatorExecutionPayload } from './validatorExecutionManifest';
import type { ValidatorReadinessObservation } from './validatorReadinessObserver';
import type { ValidatorReviewSequence } from './validatorReviewSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorResultReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorResultConfidence = 'low' | 'medium' | 'high';

export interface SectionValidatorResultContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  resultEligibility: SectionValidatorExecutionPayload['executionEligibility'];
  resultRequirements: readonly string[];
  resultBoundaries: readonly string[];
  resultVerificationRequirements: readonly string[];
  resultPreservationRequirements: readonly string[];
}

export interface ValidatorResultContractReport {
  version: 'validator-result-contracts-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallValidatorResultReadiness: ValidatorResultReadiness;
  validatorResultRequirements: readonly string[];
  validatorResultBoundaries: readonly string[];
  validatorResultVerificationRequirements: readonly string[];
  validatorResultPreservationRequirements: readonly string[];
  sectionValidatorResultContracts: readonly SectionValidatorResultContract[];
  validatorResultRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  validatorResultConfidence: ValidatorResultConfidence;
}

export interface ValidatorResultContractInput {
  validatorReviewSequence: ValidatorReviewSequence;
  validatorExecutionManifest: ValidatorExecutionManifest;
  validatorReadinessObservation: ValidatorReadinessObservation;
  acceptanceReviewPackage: AcceptanceReviewPackage;
  executorVerificationContracts: ExecutorVerificationContractReport;
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

function readiness(input: ValidatorResultContractInput): ValidatorResultReadiness {
  if (
    input.validatorReviewSequence.overallReviewSequenceReadiness === 'blocked'
    || input.validatorExecutionManifest.overallValidatorExecutionReadiness === 'blocked'
    || input.validatorReadinessObservation.overallValidatorReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorReviewSequence.overallReviewSequenceReadiness === 'conditional'
    || input.validatorExecutionManifest.overallValidatorExecutionReadiness === 'conditional'
    || input.validatorReadinessObservation.overallValidatorReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorResultReadiness, input: ValidatorResultContractInput): ValidatorResultConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorReviewSequence.reviewSequenceConfidence === 'high'
    && input.validatorExecutionManifest.validatorExecutionConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorReviewSequence.reviewSequenceConfidence === 'low'
    || input.validatorExecutionManifest.validatorExecutionConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPayloadFor(input: ValidatorResultContractInput, sectionIndex: number): SectionValidatorExecutionPayload | undefined {
  return input.validatorExecutionManifest.sectionValidatorExecutionPayloads.find((section) => section.sectionIndex === sectionIndex);
}

function sectionContract(input: ValidatorResultContractInput, sectionIndex: number): SectionValidatorResultContract | null {
  const payload = sectionPayloadFor(input, sectionIndex);
  if (!payload) return null;
  return {
    sectionIndex: payload.sectionIndex,
    progressionStage: payload.progressionStage,
    narrativeRole: payload.narrativeRole,
    resultEligibility: payload.executionEligibility,
    resultRequirements: unique([
      'structured validator result payload',
      'validator decision readiness signal',
      'unresolved result risk signals',
      ...payload.validatorOutputs,
    ], 10),
    resultBoundaries: unique(payload.executionBoundaries, 10),
    resultVerificationRequirements: unique(payload.verificationChecks, 10),
    resultPreservationRequirements: unique(payload.preservationChecks, 10),
  };
}

export function buildValidatorResultContracts(input: ValidatorResultContractInput): ValidatorResultContractReport {
  const sectionValidatorResultContracts = input.validatorReviewSequence.reviewSequenceOrder
    .map((sectionIndex) => sectionContract(input, sectionIndex))
    .filter((section): section is SectionValidatorResultContract => Boolean(section));
  const overallValidatorResultReadiness = readiness(input);

  return {
    version: 'validator-result-contracts-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorExecutionManifest.contentType,
    topic: input.validatorExecutionManifest.topic,
    overallValidatorResultReadiness,
    validatorResultRequirements: unique([
      'validator result must remain advisory and non-enforcing',
      'validator result must preserve acceptance review payload references',
      ...input.acceptanceReviewPackage.acceptanceReviewPayload.outputs,
      ...input.executorVerificationContracts.verificationOutputRequirements,
    ], 14),
    validatorResultBoundaries: unique(input.validatorExecutionManifest.validatorExecutionBoundaries, 16),
    validatorResultVerificationRequirements: unique([
      ...input.acceptanceReviewPackage.reviewVerificationRequirements,
      ...input.executorVerificationContracts.verificationRecoveryChecks,
    ], 18),
    validatorResultPreservationRequirements: unique([
      ...input.acceptanceReviewPackage.reviewPreservationRequirements,
      ...input.validatorReadinessObservation.validatorPreservationCoverage,
    ], 18),
    sectionValidatorResultContracts,
    validatorResultRiskProfile: {
      lowRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.lowRisk,
      mediumRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.mediumRisk,
      highRisk: input.validatorExecutionManifest.validatorExecutionRiskProfile.highRisk,
      gaps: input.validatorReadinessObservation.validatorGapSignals.length,
      deferred: input.validatorExecutionManifest.validatorDeferredTargets.length,
    },
    validatorResultConfidence: confidence(overallValidatorResultReadiness, input),
  };
}

export function serializeValidatorResultContracts(report: ValidatorResultContractReport): string {
  return [
    '## VALIDATOR RESULT CONTRACTS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Result readiness: ${report.overallValidatorResultReadiness}`,
    `Result confidence: ${report.validatorResultConfidence}`,
    `Section result contracts: ${report.sectionValidatorResultContracts.length}`,
    `Result boundaries: ${report.validatorResultBoundaries.length}`,
    `Verification requirements: ${report.validatorResultVerificationRequirements.length}`,
  ].join('\n');
}
