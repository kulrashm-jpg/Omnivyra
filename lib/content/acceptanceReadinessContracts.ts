import type {
  ExecutorVerificationContractReport,
  SectionExecutorVerificationContract,
} from './executorVerificationContracts';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type {
  SectionVerificationCoverage,
  VerificationReadinessObservation,
} from './verificationReadinessObserver';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type AcceptanceReadiness = 'ready' | 'conditional' | 'blocked';
export type AcceptanceEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type AcceptanceConfidence = 'low' | 'medium' | 'high';

export interface SectionAcceptanceContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  acceptanceEligibility: AcceptanceEligibility;
  acceptanceInputRequirements: readonly string[];
  acceptanceOutputRequirements: readonly string[];
  preservationRequirements: readonly string[];
  boundaryRequirements: readonly string[];
  dependencyRequirements: readonly string[];
  narrativeRequirements: readonly string[];
  authorityRequirements: readonly string[];
  antiRepetitionRequirements: readonly string[];
  recoveryRequirements: readonly string[];
  verificationRequirements: readonly string[];
}

export interface AcceptanceReadinessContractReport {
  version: 'acceptance-readiness-contracts-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallAcceptanceReadiness: AcceptanceReadiness;
  acceptanceEligibility: AcceptanceEligibility;
  acceptanceInputRequirements: readonly string[];
  acceptanceOutputRequirements: readonly string[];
  acceptancePreservationRequirements: readonly string[];
  acceptanceBoundaryRequirements: readonly string[];
  acceptanceDependencyRequirements: readonly string[];
  acceptanceNarrativeRequirements: readonly string[];
  acceptanceAuthorityRequirements: readonly string[];
  acceptanceAntiRepetitionRequirements: readonly string[];
  acceptanceRecoveryRequirements: readonly string[];
  acceptanceVerificationRequirements: readonly string[];
  sectionAcceptanceContracts: readonly SectionAcceptanceContract[];
  acceptanceRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  acceptanceConfidence: AcceptanceConfidence;
}

export interface AcceptanceReadinessContractInput {
  verificationReadinessObservation: VerificationReadinessObservation;
  executorVerificationContracts: ExecutorVerificationContractReport;
  recoveryExecutorContracts: RecoveryExecutorContractReport;
  recoveryExecutionDryRun: RecoveryExecutionDryRunPlan;
}

function unique(values: readonly string[], limit = 14): string[] {
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

function coverageFor(
  input: AcceptanceReadinessContractInput,
  sectionIndex: number,
): SectionVerificationCoverage | undefined {
  return input.verificationReadinessObservation.sectionVerificationCoverage.find((section) => section.sectionIndex === sectionIndex);
}

function acceptanceEligibility(
  section: SectionExecutorVerificationContract,
  coverage: SectionVerificationCoverage | undefined,
): AcceptanceEligibility {
  if (section.verificationEligibility === 'not_recommended') return 'not_recommended';
  if (coverage?.coverageStatus === 'insufficient') return 'not_recommended';
  if (section.verificationEligibility === 'deferred' || coverage?.coverageStatus === 'partial') return 'deferred';
  return 'eligible';
}

function sectionAcceptanceContract(
  input: AcceptanceReadinessContractInput,
  section: SectionExecutorVerificationContract,
): SectionAcceptanceContract {
  const coverage = coverageFor(input, section.sectionIndex);
  const coverageGaps = coverage?.coverageGaps || [];

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    acceptanceEligibility: acceptanceEligibility(section, coverage),
    acceptanceInputRequirements: unique([
      'future executor output package',
      'executor verification report',
      'section verification contract',
      'verification readiness observation',
      ...section.verificationInputRequirements,
    ], 10),
    acceptanceOutputRequirements: unique([
      'acceptance decision package',
      'preservation acceptance notes',
      'boundary acceptance notes',
      'dependency acceptance notes',
      'unresolved acceptance risk report',
      ...section.verificationOutputRequirements,
    ], 10),
    preservationRequirements: unique([
      ...section.preservationChecks,
      ...coverageGaps.filter((gap) => /preservation/i.test(gap)).map((gap) => `resolve acceptance gap: ${gap}`),
    ], 12),
    boundaryRequirements: unique([
      ...section.boundaryChecks,
      ...coverageGaps.filter((gap) => /boundary/i.test(gap)).map((gap) => `resolve acceptance gap: ${gap}`),
    ], 12),
    dependencyRequirements: unique([
      ...section.dependencyChecks,
      ...coverageGaps.filter((gap) => /dependency/i.test(gap)).map((gap) => `resolve acceptance gap: ${gap}`),
    ], 10),
    narrativeRequirements: unique([
      `acceptance must preserve progression stage: ${section.progressionStage}`,
      `acceptance must preserve narrative role: ${section.narrativeRole}`,
      ...section.narrativeChecks,
    ], 10),
    authorityRequirements: unique([
      'acceptance must reject unsupported authority expansion',
      ...section.authorityChecks,
    ], 10),
    antiRepetitionRequirements: unique([
      'acceptance must preserve section differentiation',
      ...section.antiRepetitionChecks,
    ], 10),
    recoveryRequirements: unique(section.recoveryChecks, 12),
    verificationRequirements: unique([
      'verification coverage must be sufficient or explicitly deferred',
      ...coverageGaps.map((gap) => `close verification gap before acceptance: ${gap}`),
    ], 12),
  };
}

function overallReadiness(input: AcceptanceReadinessContractInput): AcceptanceReadiness {
  const verification = input.executorVerificationContracts;
  const observation = input.verificationReadinessObservation;
  if (
    verification.overallVerificationReadiness === 'blocked'
    || observation.overallVerificationCoverage === 'insufficient'
    || input.recoveryExecutionDryRun.overallDryRunReadiness === 'blocked'
  ) return 'blocked';
  if (
    verification.overallVerificationReadiness === 'conditional'
    || observation.overallVerificationCoverage === 'partial'
    || input.recoveryExecutionDryRun.overallDryRunReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function overallEligibility(readiness: AcceptanceReadiness, input: AcceptanceReadinessContractInput): AcceptanceEligibility {
  if (
    input.executorVerificationContracts.verificationEligibility === 'not_recommended'
    || input.recoveryExecutorContracts.executorEligibility === 'not_recommended'
  ) return 'not_recommended';
  if (readiness === 'blocked') return 'not_recommended';
  if (
    readiness === 'conditional'
    || input.executorVerificationContracts.verificationEligibility === 'deferred'
    || input.recoveryExecutorContracts.executorEligibility === 'deferred'
  ) return 'deferred';
  return 'eligible';
}

function confidence(readiness: AcceptanceReadiness, input: AcceptanceReadinessContractInput): AcceptanceConfidence {
  if (
    readiness === 'ready'
    && input.verificationReadinessObservation.verificationCoverageConfidence === 'high'
    && input.executorVerificationContracts.verificationConfidence === 'high'
  ) return 'high';
  if (
    readiness === 'blocked'
    || input.verificationReadinessObservation.verificationCoverageConfidence === 'low'
    || input.executorVerificationContracts.verificationConfidence === 'low'
  ) return 'low';
  return 'medium';
}

export function buildAcceptanceReadinessContracts(input: AcceptanceReadinessContractInput): AcceptanceReadinessContractReport {
  const sectionAcceptanceContracts = input.executorVerificationContracts.sectionVerificationContracts.map((section) => {
    return sectionAcceptanceContract(input, section);
  });
  const readiness = overallReadiness(input);

  return {
    version: 'acceptance-readiness-contracts-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.executorVerificationContracts.contentType,
    topic: input.executorVerificationContracts.topic,
    overallAcceptanceReadiness: readiness,
    acceptanceEligibility: overallEligibility(readiness, input),
    acceptanceInputRequirements: unique([
      'future executor output package',
      'executor verification contracts',
      'verification readiness observation',
      'recovery executor contracts',
      'recovery execution dry-run plan',
      ...input.executorVerificationContracts.verificationInputRequirements,
    ], 12),
    acceptanceOutputRequirements: unique([
      'structured acceptance review package',
      'acceptance eligibility determination',
      'final preservation verification summary',
      'final boundary verification summary',
      'unresolved recovery acceptance risks',
      ...input.executorVerificationContracts.verificationOutputRequirements,
    ], 12),
    acceptancePreservationRequirements: unique(input.executorVerificationContracts.verificationPreservationChecks, 14),
    acceptanceBoundaryRequirements: unique(input.executorVerificationContracts.verificationBoundaryChecks, 14),
    acceptanceDependencyRequirements: unique(input.executorVerificationContracts.verificationDependencyChecks, 14),
    acceptanceNarrativeRequirements: unique(input.executorVerificationContracts.verificationNarrativeChecks, 14),
    acceptanceAuthorityRequirements: unique(input.executorVerificationContracts.verificationAuthorityChecks, 14),
    acceptanceAntiRepetitionRequirements: unique(input.executorVerificationContracts.verificationAntiRepetitionChecks, 14),
    acceptanceRecoveryRequirements: unique(input.executorVerificationContracts.verificationRecoveryChecks, 14),
    acceptanceVerificationRequirements: unique([
      ...input.verificationReadinessObservation.verificationCompletenessSignals,
      ...input.verificationReadinessObservation.verificationGapSignals.map((gap) => `resolve verification gap before acceptance: ${gap}`),
    ], 16),
    sectionAcceptanceContracts,
    acceptanceRiskProfile: {
      lowRisk: input.executorVerificationContracts.verificationRiskProfile.lowRisk,
      mediumRisk: input.executorVerificationContracts.verificationRiskProfile.mediumRisk,
      highRisk: input.executorVerificationContracts.verificationRiskProfile.highRisk,
      gaps: input.verificationReadinessObservation.verificationGapSignals.length,
      deferred: input.executorVerificationContracts.verificationRiskProfile.deferred,
    },
    acceptanceConfidence: confidence(readiness, input),
  };
}

export function serializeAcceptanceReadinessContracts(report: AcceptanceReadinessContractReport): string {
  return [
    '## ACCEPTANCE READINESS CONTRACTS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Acceptance readiness: ${report.overallAcceptanceReadiness}`,
    `Acceptance eligibility: ${report.acceptanceEligibility}`,
    `Acceptance confidence: ${report.acceptanceConfidence}`,
    `Section acceptance contracts: ${report.sectionAcceptanceContracts.length}`,
    `Preservation requirements: ${report.acceptancePreservationRequirements.length}`,
    `Boundary requirements: ${report.acceptanceBoundaryRequirements.length}`,
    `Verification requirements: ${report.acceptanceVerificationRequirements.length}`,
  ].join('\n');
}
