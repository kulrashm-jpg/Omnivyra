import type {
  AcceptanceReadinessContractReport,
  SectionAcceptanceContract,
} from './acceptanceReadinessContracts';
import type { ExecutorVerificationContractReport } from './executorVerificationContracts';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type { VerificationReadinessObservation } from './verificationReadinessObserver';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type AcceptancePackageReadiness = 'ready' | 'conditional' | 'blocked';
export type AcceptanceReviewConfidence = 'low' | 'medium' | 'high';

export interface SectionAcceptanceReviewPayload {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  acceptanceEligibility: SectionAcceptanceContract['acceptanceEligibility'];
  reviewInputs: readonly string[];
  reviewOutputs: readonly string[];
  reviewBoundaries: readonly string[];
  reviewPreservationRequirements: readonly string[];
  reviewVerificationRequirements: readonly string[];
  reviewDependencies: readonly string[];
}

export interface AcceptanceReviewPackage {
  version: 'acceptance-review-package-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallAcceptancePackageReadiness: AcceptancePackageReadiness;
  acceptanceReviewPayload: {
    inputs: readonly string[];
    outputs: readonly string[];
    eligibility: AcceptanceReadinessContractReport['acceptanceEligibility'];
    readiness: AcceptanceReadinessContractReport['overallAcceptanceReadiness'];
  };
  reviewBoundaryRequirements: readonly string[];
  reviewPreservationRequirements: readonly string[];
  reviewVerificationRequirements: readonly string[];
  sectionAcceptanceReviewPayloads: readonly SectionAcceptanceReviewPayload[];
  acceptanceReviewRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  acceptanceReviewConfidence: AcceptanceReviewConfidence;
}

export interface AcceptanceReviewPackageInput {
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

function packageReadiness(input: AcceptanceReviewPackageInput): AcceptancePackageReadiness {
  if (
    input.acceptanceReadinessContracts.overallAcceptanceReadiness === 'blocked'
    || input.verificationReadinessObservation.overallVerificationCoverage === 'insufficient'
    || input.recoveryExecutionDryRun.overallDryRunReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.acceptanceReadinessContracts.overallAcceptanceReadiness === 'conditional'
    || input.verificationReadinessObservation.overallVerificationCoverage === 'partial'
    || input.recoveryExecutionDryRun.overallDryRunReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readiness: AcceptancePackageReadiness, input: AcceptanceReviewPackageInput): AcceptanceReviewConfidence {
  if (
    readiness === 'ready'
    && input.acceptanceReadinessContracts.acceptanceConfidence === 'high'
    && input.verificationReadinessObservation.verificationCoverageConfidence === 'high'
  ) return 'high';
  if (
    readiness === 'blocked'
    || input.acceptanceReadinessContracts.acceptanceConfidence === 'low'
    || input.verificationReadinessObservation.verificationCoverageConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPayload(section: SectionAcceptanceContract): SectionAcceptanceReviewPayload {
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    acceptanceEligibility: section.acceptanceEligibility,
    reviewInputs: unique(section.acceptanceInputRequirements, 10),
    reviewOutputs: unique(section.acceptanceOutputRequirements, 10),
    reviewBoundaries: unique(section.boundaryRequirements, 10),
    reviewPreservationRequirements: unique(section.preservationRequirements, 10),
    reviewVerificationRequirements: unique(section.verificationRequirements, 10),
    reviewDependencies: unique(section.dependencyRequirements, 10),
  };
}

export function assembleAcceptanceReviewPackage(input: AcceptanceReviewPackageInput): AcceptanceReviewPackage {
  const readiness = packageReadiness(input);
  const acceptance = input.acceptanceReadinessContracts;
  return {
    version: 'acceptance-review-package-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: acceptance.contentType,
    topic: acceptance.topic,
    overallAcceptancePackageReadiness: readiness,
    acceptanceReviewPayload: {
      inputs: unique([
        ...acceptance.acceptanceInputRequirements,
        ...input.executorVerificationContracts.verificationInputRequirements,
      ], 14),
      outputs: unique([
        ...acceptance.acceptanceOutputRequirements,
        ...input.executorVerificationContracts.verificationOutputRequirements,
      ], 14),
      eligibility: acceptance.acceptanceEligibility,
      readiness: acceptance.overallAcceptanceReadiness,
    },
    reviewBoundaryRequirements: unique([
      ...acceptance.acceptanceBoundaryRequirements,
      ...input.recoveryExecutorContracts.executorBoundaryRequirements,
    ], 16),
    reviewPreservationRequirements: unique([
      ...acceptance.acceptancePreservationRequirements,
      ...input.recoveryExecutorContracts.executorPreservationRequirements,
    ], 16),
    reviewVerificationRequirements: unique([
      ...acceptance.acceptanceVerificationRequirements,
      ...acceptance.acceptanceRecoveryRequirements,
      ...input.verificationReadinessObservation.verificationGapSignals,
    ], 18),
    sectionAcceptanceReviewPayloads: acceptance.sectionAcceptanceContracts.map(sectionPayload),
    acceptanceReviewRiskProfile: {
      lowRisk: acceptance.acceptanceRiskProfile.lowRisk,
      mediumRisk: acceptance.acceptanceRiskProfile.mediumRisk,
      highRisk: acceptance.acceptanceRiskProfile.highRisk,
      gaps: acceptance.acceptanceRiskProfile.gaps,
      deferred: acceptance.acceptanceRiskProfile.deferred,
    },
    acceptanceReviewConfidence: confidence(readiness, input),
  };
}

export function serializeAcceptanceReviewPackage(pkg: AcceptanceReviewPackage): string {
  return [
    '## ACCEPTANCE REVIEW PACKAGE',
    `Version: ${pkg.version}`,
    `Topic: ${pkg.topic}`,
    `Content type: ${pkg.contentType}`,
    `Package readiness: ${pkg.overallAcceptancePackageReadiness}`,
    `Package confidence: ${pkg.acceptanceReviewConfidence}`,
    `Section review payloads: ${pkg.sectionAcceptanceReviewPayloads.length}`,
    `Boundary requirements: ${pkg.reviewBoundaryRequirements.length}`,
    `Preservation requirements: ${pkg.reviewPreservationRequirements.length}`,
    `Verification requirements: ${pkg.reviewVerificationRequirements.length}`,
  ].join('\n');
}
