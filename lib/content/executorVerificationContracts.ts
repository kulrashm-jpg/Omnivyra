import type {
  RegenerationExecutionManifest,
  SectionRegenerationExecutionManifest,
} from './regenerationExecutionManifest';
import type { RegenerationReadinessContract } from './regenerationReadinessContracts';
import type {
  RecoveryExecutionDryRunPlan,
  SectionRecoveryDryRunPlan,
} from './recoveryExecutionDryRunPlanner';
import type {
  RecoveryExecutorContractReport,
  SectionRecoveryExecutorContract,
} from './recoveryExecutorContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ExecutorVerificationReadiness = 'ready' | 'conditional' | 'blocked';
export type ExecutorVerificationEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ExecutorVerificationConfidence = 'low' | 'medium' | 'high';

export interface SectionExecutorVerificationContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  verificationEligibility: ExecutorVerificationEligibility;
  verificationInputRequirements: readonly string[];
  verificationOutputRequirements: readonly string[];
  preservationChecks: readonly string[];
  boundaryChecks: readonly string[];
  dependencyChecks: readonly string[];
  narrativeChecks: readonly string[];
  authorityChecks: readonly string[];
  antiRepetitionChecks: readonly string[];
  recoveryChecks: readonly string[];
}

export interface ExecutorVerificationContractReport {
  version: 'executor-verification-contracts-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallVerificationReadiness: ExecutorVerificationReadiness;
  verificationEligibility: ExecutorVerificationEligibility;
  verificationInputRequirements: readonly string[];
  verificationOutputRequirements: readonly string[];
  verificationPreservationChecks: readonly string[];
  verificationBoundaryChecks: readonly string[];
  verificationDependencyChecks: readonly string[];
  verificationNarrativeChecks: readonly string[];
  verificationAuthorityChecks: readonly string[];
  verificationAntiRepetitionChecks: readonly string[];
  verificationRecoveryChecks: readonly string[];
  sectionVerificationContracts: readonly SectionExecutorVerificationContract[];
  verificationRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    conflicts: number;
    deferred: number;
  };
  verificationConfidence: ExecutorVerificationConfidence;
}

export interface ExecutorVerificationContractInput {
  recoveryExecutorContracts: RecoveryExecutorContractReport;
  recoveryExecutionDryRun: RecoveryExecutionDryRunPlan;
  regenerationExecutionManifest: RegenerationExecutionManifest;
  regenerationReadinessContract: RegenerationReadinessContract;
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

function manifestFor(input: ExecutorVerificationContractInput, sectionIndex: number): SectionRegenerationExecutionManifest | undefined {
  return input.regenerationExecutionManifest.sectionExecutionManifests.find((manifest) => manifest.sectionIndex === sectionIndex);
}

function dryRunFor(input: ExecutorVerificationContractInput, sectionIndex: number): SectionRecoveryDryRunPlan | undefined {
  return input.recoveryExecutionDryRun.sectionDryRunPlans.find((section) => section.sectionIndex === sectionIndex);
}

function eligibilityFor(section: SectionRecoveryExecutorContract): ExecutorVerificationEligibility {
  if (section.executorEligibility === 'not_recommended') return 'not_recommended';
  if (section.executorEligibility === 'deferred') return 'deferred';
  return 'eligible';
}

function sectionVerificationContract(
  input: ExecutorVerificationContractInput,
  section: SectionRecoveryExecutorContract,
): SectionExecutorVerificationContract {
  const manifest = manifestFor(input, section.sectionIndex);
  const dryRun = dryRunFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    verificationEligibility: eligibilityFor(section),
    verificationInputRequirements: unique([
      'executor section output',
      'section executor contract',
      'section dry-run plan',
      'section execution manifest',
      ...section.inputRequirements,
    ], 10),
    verificationOutputRequirements: unique([
      'acceptance eligibility summary',
      'preservation check results',
      'boundary check results',
      'dependency check results',
      'unresolved verification risks',
    ], 10),
    preservationChecks: unique([
      ...section.preservationRequirements,
      ...(manifest?.preservationRequirements || []),
      ...(dryRun?.preservationChecks || []),
    ], 12),
    boundaryChecks: unique([
      ...section.boundaryRequirements,
      ...(manifest?.rewriteBoundaries || []),
    ], 12),
    dependencyChecks: unique([
      ...section.dependencyRequirements,
      ...(dryRun?.dependencyChecks || []),
    ], 10),
    narrativeChecks: unique([
      `preserve progression stage: ${section.progressionStage}`,
      `preserve narrative role: ${section.narrativeRole}`,
      ...input.regenerationReadinessContract.narrativePreservationRequirements,
    ], 8),
    authorityChecks: unique([
      'verify no unsupported evidence was introduced',
      ...input.regenerationReadinessContract.authorityPreservationRequirements,
    ], 8),
    antiRepetitionChecks: unique([
      'verify section responsibility remains distinct',
      ...input.regenerationReadinessContract.antiRepetitionRecoveryRequirements,
    ], 8),
    recoveryChecks: unique([
      ...section.recoveryTargets.map((target) => `verify recovery target: ${target}`),
      ...section.verificationRequirements,
    ], 12),
  };
}

function readiness(input: ExecutorVerificationContractInput): ExecutorVerificationReadiness {
  if (input.recoveryExecutorContracts.overallExecutorReadiness === 'blocked') return 'blocked';
  if (
    input.recoveryExecutorContracts.overallExecutorReadiness === 'conditional'
    || input.recoveryExecutionDryRun.overallDryRunReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(input: ExecutorVerificationContractInput): ExecutorVerificationEligibility {
  if (input.recoveryExecutorContracts.executorEligibility === 'not_recommended') return 'not_recommended';
  if (input.recoveryExecutorContracts.executorEligibility === 'deferred') return 'deferred';
  return 'eligible';
}

export function buildExecutorVerificationContracts(input: ExecutorVerificationContractInput): ExecutorVerificationContractReport {
  const sectionVerificationContracts = input.recoveryExecutorContracts.sectionExecutorContracts.map((section) => sectionVerificationContract(input, section));
  return {
    version: 'executor-verification-contracts-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.recoveryExecutorContracts.contentType,
    topic: input.recoveryExecutorContracts.topic,
    overallVerificationReadiness: readiness(input),
    verificationEligibility: eligibility(input),
    verificationInputRequirements: unique([
      'executor output package',
      'recovery executor contracts',
      'recovery execution dry-run plan',
      'regeneration execution manifest',
      'regeneration readiness contract',
    ], 10),
    verificationOutputRequirements: unique([
      'structured verification report',
      'per-section acceptance eligibility',
      'preservation check report',
      'boundary check report',
      'unresolved verification risk report',
    ], 10),
    verificationPreservationChecks: unique(input.recoveryExecutorContracts.executorPreservationRequirements, 14),
    verificationBoundaryChecks: unique(input.recoveryExecutorContracts.executorBoundaryRequirements, 14),
    verificationDependencyChecks: unique(input.recoveryExecutorContracts.executorDependencyRequirements, 14),
    verificationNarrativeChecks: unique(input.recoveryExecutionDryRun.narrativeStabilitySignals, 12),
    verificationAuthorityChecks: unique(input.recoveryExecutionDryRun.authorityStabilitySignals, 12),
    verificationAntiRepetitionChecks: unique(input.recoveryExecutionDryRun.antiRepetitionStabilitySignals, 12),
    verificationRecoveryChecks: unique([
      ...input.recoveryExecutorContracts.executorRecoveryTargets.map((target) => `verify recovery target: ${target}`),
      ...input.recoveryExecutorContracts.executorVerificationRequirements,
    ], 14),
    sectionVerificationContracts,
    verificationRiskProfile: {
      lowRisk: input.recoveryExecutorContracts.executorRiskProfile.lowRisk,
      mediumRisk: input.recoveryExecutorContracts.executorRiskProfile.mediumRisk,
      highRisk: input.recoveryExecutorContracts.executorRiskProfile.highRisk,
      conflicts: input.recoveryExecutorContracts.executorRiskProfile.conflicts,
      deferred: input.recoveryExecutorContracts.executorRiskProfile.deferred,
    },
    verificationConfidence: input.recoveryExecutorContracts.executorConfidence,
  };
}

export function serializeExecutorVerificationContracts(report: ExecutorVerificationContractReport): string {
  return [
    '## EXECUTOR VERIFICATION CONTRACTS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Verification readiness: ${report.overallVerificationReadiness}`,
    `Verification eligibility: ${report.verificationEligibility}`,
    `Verification confidence: ${report.verificationConfidence}`,
    `Section verification contracts: ${report.sectionVerificationContracts.length}`,
    `Preservation checks: ${report.verificationPreservationChecks.length}`,
    `Boundary checks: ${report.verificationBoundaryChecks.length}`,
  ].join('\n');
}
