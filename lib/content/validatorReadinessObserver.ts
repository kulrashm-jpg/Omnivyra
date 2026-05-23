import type { AcceptanceReadinessContractReport } from './acceptanceReadinessContracts';
import type { AcceptanceReviewPackage } from './acceptanceReviewPackageAssembler';
import type { ExecutorVerificationContractReport } from './executorVerificationContracts';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type { VerificationReadinessObservation } from './verificationReadinessObserver';

export type ValidatorReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorReadinessConfidence = 'low' | 'medium' | 'high';

export interface ValidatorReadinessObservation {
  version: 'validator-readiness-observer-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallValidatorReadiness: ValidatorReadiness;
  validatorCoverageSignals: readonly string[];
  validatorDependencySignals: readonly string[];
  validatorPreservationCoverage: readonly string[];
  validatorBoundaryCoverage: readonly string[];
  validatorGapSignals: readonly string[];
  validatorReadinessConfidence: ValidatorReadinessConfidence;
}

export interface ValidatorReadinessObserverInput {
  acceptanceReviewPackage: AcceptanceReviewPackage;
  acceptanceReadinessContracts: AcceptanceReadinessContractReport;
  verificationReadinessObservation: VerificationReadinessObservation;
  executorVerificationContracts: ExecutorVerificationContractReport;
  recoveryExecutorContracts: RecoveryExecutorContractReport;
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

function readiness(input: ValidatorReadinessObserverInput): ValidatorReadiness {
  if (
    input.acceptanceReviewPackage.overallAcceptancePackageReadiness === 'blocked'
    || input.verificationReadinessObservation.overallVerificationCoverage === 'insufficient'
    || input.acceptanceReadinessContracts.overallAcceptanceReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.acceptanceReviewPackage.overallAcceptancePackageReadiness === 'conditional'
    || input.verificationReadinessObservation.overallVerificationCoverage === 'partial'
    || input.acceptanceReadinessContracts.overallAcceptanceReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorReadiness, input: ValidatorReadinessObserverInput): ValidatorReadinessConfidence {
  if (
    readinessValue === 'ready'
    && input.acceptanceReviewPackage.acceptanceReviewConfidence === 'high'
    && input.verificationReadinessObservation.verificationCoverageConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.acceptanceReviewPackage.acceptanceReviewConfidence === 'low'
    || input.verificationReadinessObservation.verificationCoverageConfidence === 'low'
  ) return 'low';
  return 'medium';
}

export function observeValidatorReadiness(input: ValidatorReadinessObserverInput): ValidatorReadinessObservation {
  const overallValidatorReadiness = readiness(input);
  const validatorGapSignals = unique([
    ...input.verificationReadinessObservation.verificationGapSignals,
    ...(input.acceptanceReviewPackage.sectionAcceptanceReviewPayloads.length === 0 ? ['missing section acceptance review payloads'] : []),
    ...(input.acceptanceReviewPackage.reviewBoundaryRequirements.length === 0 ? ['missing validator boundary coverage'] : []),
    ...(input.acceptanceReviewPackage.reviewPreservationRequirements.length === 0 ? ['missing validator preservation coverage'] : []),
  ], 18);

  return {
    version: 'validator-readiness-observer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.acceptanceReviewPackage.contentType,
    topic: input.acceptanceReviewPackage.topic,
    overallValidatorReadiness,
    validatorCoverageSignals: unique([
      `acceptance review payloads: ${input.acceptanceReviewPackage.sectionAcceptanceReviewPayloads.length}`,
      `verification coverage: ${input.verificationReadinessObservation.overallVerificationCoverage}`,
      `executor verification contracts: ${input.executorVerificationContracts.sectionVerificationContracts.length}`,
      `acceptance contract sections: ${input.acceptanceReadinessContracts.sectionAcceptanceContracts.length}`,
    ], 10),
    validatorDependencySignals: unique([
      ...input.acceptanceReadinessContracts.acceptanceDependencyRequirements,
      ...input.recoveryExecutorContracts.executorDependencyRequirements,
      ...input.recoveryExecutionDryRun.rewriteDependencySignals,
    ], 16),
    validatorPreservationCoverage: unique([
      ...input.acceptanceReviewPackage.reviewPreservationRequirements,
      ...input.verificationReadinessObservation.preservationCoverageSignals,
    ], 16),
    validatorBoundaryCoverage: unique([
      ...input.acceptanceReviewPackage.reviewBoundaryRequirements,
      ...input.verificationReadinessObservation.boundaryCoverageSignals,
    ], 16),
    validatorGapSignals,
    validatorReadinessConfidence: confidence(overallValidatorReadiness, input),
  };
}

export function serializeValidatorReadinessObservation(observation: ValidatorReadinessObservation): string {
  return [
    '## VALIDATOR READINESS OBSERVATION',
    `Version: ${observation.version}`,
    `Topic: ${observation.topic}`,
    `Content type: ${observation.contentType}`,
    `Validator readiness: ${observation.overallValidatorReadiness}`,
    `Validator confidence: ${observation.validatorReadinessConfidence}`,
    `Coverage signals: ${observation.validatorCoverageSignals.length}`,
    `Dependency signals: ${observation.validatorDependencySignals.length}`,
    `Gap signals: ${observation.validatorGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
