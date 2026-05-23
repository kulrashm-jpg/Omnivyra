import type { AcceptanceReadinessContractReport } from './acceptanceReadinessContracts';
import type {
  AcceptanceReviewPackage,
  SectionAcceptanceReviewPayload,
} from './acceptanceReviewPackageAssembler';
import type { ExecutorVerificationContractReport } from './executorVerificationContracts';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type { ValidatorReadinessObservation } from './validatorReadinessObserver';
import type { VerificationReadinessObservation } from './verificationReadinessObserver';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorExecutionReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorExecutionConfidence = 'low' | 'medium' | 'high';

export interface SectionValidatorExecutionPayload {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executionEligibility: SectionAcceptanceReviewPayload['acceptanceEligibility'];
  validatorInputs: readonly string[];
  validatorOutputs: readonly string[];
  executionBoundaries: readonly string[];
  executionConstraints: readonly string[];
  preservationChecks: readonly string[];
  verificationChecks: readonly string[];
}

export interface ValidatorExecutionManifest {
  version: 'validator-execution-manifest-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallValidatorExecutionReadiness: ValidatorExecutionReadiness;
  validatorExecutionOrder: readonly number[];
  validatorExecutionTargets: readonly number[];
  validatorExecutionBoundaries: readonly string[];
  validatorExecutionConstraints: readonly string[];
  validatorDeferredTargets: readonly number[];
  sectionValidatorExecutionPayloads: readonly SectionValidatorExecutionPayload[];
  validatorExecutionRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  validatorExecutionConfidence: ValidatorExecutionConfidence;
}

export interface ValidatorExecutionManifestInput {
  acceptanceReviewPackage: AcceptanceReviewPackage;
  validatorReadinessObservation: ValidatorReadinessObservation;
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

function readiness(input: ValidatorExecutionManifestInput): ValidatorExecutionReadiness {
  if (
    input.validatorReadinessObservation.overallValidatorReadiness === 'blocked'
    || input.acceptanceReadinessContracts.overallAcceptanceReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorReadinessObservation.overallValidatorReadiness === 'conditional'
    || input.acceptanceReviewPackage.overallAcceptancePackageReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorExecutionReadiness, input: ValidatorExecutionManifestInput): ValidatorExecutionConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorReadinessObservation.validatorReadinessConfidence === 'high'
    && input.acceptanceReviewPackage.acceptanceReviewConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorReadinessObservation.validatorReadinessConfidence === 'low'
    || input.acceptanceReviewPackage.acceptanceReviewConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPayload(payload: SectionAcceptanceReviewPayload): SectionValidatorExecutionPayload {
  return {
    sectionIndex: payload.sectionIndex,
    progressionStage: payload.progressionStage,
    narrativeRole: payload.narrativeRole,
    executionEligibility: payload.acceptanceEligibility,
    validatorInputs: unique(payload.reviewInputs, 10),
    validatorOutputs: unique(payload.reviewOutputs, 10),
    executionBoundaries: unique(payload.reviewBoundaries, 10),
    executionConstraints: unique([
      ...payload.reviewDependencies,
      'do not mutate recovered content during validator review',
      'do not change scores during validator review',
    ], 10),
    preservationChecks: unique(payload.reviewPreservationRequirements, 10),
    verificationChecks: unique(payload.reviewVerificationRequirements, 10),
  };
}

export function buildValidatorExecutionManifest(input: ValidatorExecutionManifestInput): ValidatorExecutionManifest {
  const sectionValidatorExecutionPayloads = input.acceptanceReviewPackage.sectionAcceptanceReviewPayloads.map(sectionPayload);
  const validatorExecutionOrder = input.recoveryExecutionDryRun.dryRunExecutionOrder.filter((sectionIndex) => {
    return sectionValidatorExecutionPayloads.some((section) => section.sectionIndex === sectionIndex);
  });
  const validatorExecutionTargets = sectionValidatorExecutionPayloads
    .filter((section) => section.executionEligibility === 'eligible')
    .map((section) => section.sectionIndex);
  const validatorDeferredTargets = unique([
    ...input.recoveryExecutionDryRun.simulatedDeferredExecutions.map(String),
    ...sectionValidatorExecutionPayloads
      .filter((section) => section.executionEligibility !== 'eligible')
      .map((section) => String(section.sectionIndex)),
  ]).map(Number);
  const overallValidatorExecutionReadiness = readiness(input);

  return {
    version: 'validator-execution-manifest-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.acceptanceReviewPackage.contentType,
    topic: input.acceptanceReviewPackage.topic,
    overallValidatorExecutionReadiness,
    validatorExecutionOrder,
    validatorExecutionTargets,
    validatorExecutionBoundaries: unique([
      ...input.acceptanceReviewPackage.reviewBoundaryRequirements,
      ...input.validatorReadinessObservation.validatorBoundaryCoverage,
    ], 16),
    validatorExecutionConstraints: unique([
      ...input.validatorReadinessObservation.validatorDependencySignals,
      ...input.executorVerificationContracts.verificationDependencyChecks,
      'validator review is non-executing and non-enforcing',
    ], 18),
    validatorDeferredTargets,
    sectionValidatorExecutionPayloads,
    validatorExecutionRiskProfile: {
      lowRisk: input.acceptanceReadinessContracts.acceptanceRiskProfile.lowRisk,
      mediumRisk: input.acceptanceReadinessContracts.acceptanceRiskProfile.mediumRisk,
      highRisk: input.acceptanceReadinessContracts.acceptanceRiskProfile.highRisk,
      gaps: input.verificationReadinessObservation.verificationGapSignals.length,
      deferred: validatorDeferredTargets.length || input.recoveryExecutorContracts.executorDeferredTargets.length,
    },
    validatorExecutionConfidence: confidence(overallValidatorExecutionReadiness, input),
  };
}

export function serializeValidatorExecutionManifest(manifest: ValidatorExecutionManifest): string {
  return [
    '## VALIDATOR EXECUTION MANIFEST',
    `Version: ${manifest.version}`,
    `Topic: ${manifest.topic}`,
    `Content type: ${manifest.contentType}`,
    `Validator execution readiness: ${manifest.overallValidatorExecutionReadiness}`,
    `Validator execution confidence: ${manifest.validatorExecutionConfidence}`,
    `Execution order: ${manifest.validatorExecutionOrder.join(', ') || 'none'}`,
    `Execution targets: ${manifest.validatorExecutionTargets.join(', ') || 'none'}`,
    `Deferred targets: ${manifest.validatorDeferredTargets.join(', ') || 'none'}`,
  ].join('\n');
}
