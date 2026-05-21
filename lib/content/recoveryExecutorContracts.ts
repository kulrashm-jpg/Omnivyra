import type {
  RegenerationCandidateSelection,
  SectionRecoveryCandidate,
} from './regenerationCandidateSelector';
import type {
  RegenerationExecutionManifest,
  SectionRegenerationExecutionManifest,
} from './regenerationExecutionManifest';
import type { RegenerationReadinessContract } from './regenerationReadinessContracts';
import type {
  RecoveryExecutionDryRunPlan,
  SectionRecoveryDryRunPlan,
} from './recoveryExecutionDryRunPlanner';
import type { EditorialRemediationPriority } from './editorialRemediationHints';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type RecoveryExecutorReadiness = 'ready' | 'conditional' | 'blocked';
export type RecoveryExecutorEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type RecoveryExecutorConfidence = 'low' | 'medium' | 'high';

export interface SectionRecoveryExecutorContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executorEligibility: RecoveryExecutorEligibility;
  executionPriority: EditorialRemediationPriority;
  inputRequirements: readonly string[];
  outputRequirements: readonly string[];
  preservationRequirements: readonly string[];
  boundaryRequirements: readonly string[];
  dependencyRequirements: readonly string[];
  verificationRequirements: readonly string[];
  recoveryTargets: readonly string[];
}

export interface RecoveryExecutorContractReport {
  version: 'recovery-executor-contracts-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallExecutorReadiness: RecoveryExecutorReadiness;
  executorEligibility: RecoveryExecutorEligibility;
  executorInputRequirements: readonly string[];
  executorOutputRequirements: readonly string[];
  executorPreservationRequirements: readonly string[];
  executorBoundaryRequirements: readonly string[];
  executorDependencyRequirements: readonly string[];
  executorVerificationRequirements: readonly string[];
  executorRecoveryTargets: readonly string[];
  executorExecutionSequence: readonly number[];
  executorDeferredTargets: readonly number[];
  sectionExecutorContracts: readonly SectionRecoveryExecutorContract[];
  executorRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    conflicts: number;
    deferred: number;
  };
  executorConfidence: RecoveryExecutorConfidence;
}

export interface RecoveryExecutorContractInput {
  recoveryExecutionDryRun: RecoveryExecutionDryRunPlan;
  regenerationExecutionManifest: RegenerationExecutionManifest;
  regenerationCandidateSelection: RegenerationCandidateSelection;
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

function candidateFor(input: RecoveryExecutorContractInput, sectionIndex: number): SectionRecoveryCandidate | undefined {
  return input.regenerationCandidateSelection.sectionRecoveryCandidates.find((candidate) => candidate.sectionIndex === sectionIndex);
}

function manifestFor(input: RecoveryExecutorContractInput, sectionIndex: number): SectionRegenerationExecutionManifest | undefined {
  return input.regenerationExecutionManifest.sectionExecutionManifests.find((manifest) => manifest.sectionIndex === sectionIndex);
}

function eligibilityFor(
  section: SectionRecoveryDryRunPlan,
  candidate: SectionRecoveryCandidate | undefined,
): RecoveryExecutorEligibility {
  if (section.simulatedExecutionReadiness === 'blocked' || candidate?.eligibility === 'deferred') return 'deferred';
  if (candidate?.eligibility === 'not_recommended') return 'not_recommended';
  return 'eligible';
}

function outputRequirements(section: SectionRecoveryDryRunPlan): string[] {
  return unique([
    'return structured recovered section draft only when a future executor is enabled',
    'return preservation verification notes',
    'return boundary adherence notes',
    'return unresolved risk flags',
    `preserve progression stage: ${section.progressionStage}`,
    `preserve narrative role: ${section.narrativeRole}`,
  ], 8);
}

function verificationRequirements(section: SectionRecoveryDryRunPlan): string[] {
  return unique([
    'verify no new unsupported evidence was introduced',
    'verify rewrite boundaries were honored',
    'verify preservation requirements remain visible',
    'verify recovery targets were addressed',
    ...section.conflictSignals.map((signal) => `resolve conflict: ${signal}`),
  ], 10);
}

function sectionContract(
  input: RecoveryExecutorContractInput,
  section: SectionRecoveryDryRunPlan,
): SectionRecoveryExecutorContract {
  const candidate = candidateFor(input, section.sectionIndex);
  const manifest = manifestFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    executorEligibility: eligibilityFor(section, candidate),
    executionPriority: candidate?.priority || manifest?.executionPriority || 'low',
    inputRequirements: unique([
      'source section content',
      'section execution manifest',
      'section dry-run plan',
      'regeneration readiness contract',
      ...section.recoveryTargets.map((target) => `target: ${target}`),
    ], 10),
    outputRequirements: outputRequirements(section),
    preservationRequirements: unique([
      ...section.preservationChecks,
      ...(manifest?.preservationRequirements || []),
    ], 12),
    boundaryRequirements: unique([
      ...(manifest?.rewriteBoundaries || []),
      ...(candidate?.rewriteBoundaries || []),
    ], 10),
    dependencyRequirements: unique(section.dependencyChecks, 10),
    verificationRequirements: verificationRequirements(section),
    recoveryTargets: section.recoveryTargets,
  };
}

function overallEligibility(input: RecoveryExecutorContractInput): RecoveryExecutorEligibility {
  if (input.recoveryExecutionDryRun.overallDryRunReadiness === 'blocked') return 'deferred';
  if (input.regenerationCandidateSelection.overallRecoveryEligibility === 'not_recommended') return 'not_recommended';
  return 'eligible';
}

function readiness(input: RecoveryExecutorContractInput): RecoveryExecutorReadiness {
  if (input.recoveryExecutionDryRun.overallDryRunReadiness === 'blocked') return 'blocked';
  if (input.recoveryExecutionDryRun.overallDryRunReadiness === 'conditional') return 'conditional';
  return 'ready';
}

export function buildRecoveryExecutorContracts(input: RecoveryExecutorContractInput): RecoveryExecutorContractReport {
  const sectionExecutorContracts = input.recoveryExecutionDryRun.sectionDryRunPlans.map((section) => sectionContract(input, section));
  return {
    version: 'recovery-executor-contracts-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.recoveryExecutionDryRun.contentType,
    topic: input.recoveryExecutionDryRun.topic,
    overallExecutorReadiness: readiness(input),
    executorEligibility: overallEligibility(input),
    executorInputRequirements: unique([
      'original generated content',
      'regeneration execution manifest',
      'recovery execution dry-run plan',
      'regeneration readiness contract',
      'candidate selection context',
    ], 10),
    executorOutputRequirements: unique([
      'structured recovered section outputs',
      'per-section preservation verification',
      'per-section boundary verification',
      'unresolved conflict report',
      'no score mutation or enforcement side effects',
    ], 10),
    executorPreservationRequirements: unique([
      ...input.regenerationReadinessContract.preservationConstraints,
      ...input.recoveryExecutionDryRun.narrativeStabilitySignals,
      ...input.recoveryExecutionDryRun.authorityStabilitySignals,
      ...input.recoveryExecutionDryRun.antiRepetitionStabilitySignals,
    ], 14),
    executorBoundaryRequirements: unique([
      ...input.regenerationReadinessContract.safeRecoveryBoundaries,
      ...Object.values(input.regenerationExecutionManifest.executionBoundaryMap).flat(),
    ], 14),
    executorDependencyRequirements: unique(input.recoveryExecutionDryRun.rewriteDependencySignals, 14),
    executorVerificationRequirements: unique([
      'verify preservation requirements before accepting recovered output',
      'verify rewrite boundaries before accepting recovered output',
      'verify no regeneration side effects outside selected sections',
      ...input.recoveryExecutionDryRun.preservationConflictSignals,
    ], 12),
    executorRecoveryTargets: input.recoveryExecutionDryRun.dryRunRecoveryTargets,
    executorExecutionSequence: input.recoveryExecutionDryRun.dryRunExecutionOrder,
    executorDeferredTargets: input.recoveryExecutionDryRun.simulatedDeferredExecutions,
    sectionExecutorContracts,
    executorRiskProfile: {
      lowRisk: input.recoveryExecutionDryRun.dryRunRiskProfile.lowRisk,
      mediumRisk: input.recoveryExecutionDryRun.dryRunRiskProfile.mediumRisk,
      highRisk: input.recoveryExecutionDryRun.dryRunRiskProfile.highRisk,
      conflicts: input.recoveryExecutionDryRun.dryRunRiskProfile.conflicts,
      deferred: input.recoveryExecutionDryRun.dryRunRiskProfile.deferred,
    },
    executorConfidence: input.recoveryExecutionDryRun.dryRunConfidence,
  };
}

export function serializeRecoveryExecutorContracts(report: RecoveryExecutorContractReport): string {
  return [
    '## RECOVERY EXECUTOR CONTRACTS',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Executor readiness: ${report.overallExecutorReadiness}`,
    `Executor eligibility: ${report.executorEligibility}`,
    `Executor confidence: ${report.executorConfidence}`,
    `Execution sequence: ${report.executorExecutionSequence.join(', ') || 'none'}`,
    `Section contracts: ${report.sectionExecutorContracts.length}`,
    `Deferred targets: ${report.executorDeferredTargets.join(', ') || 'none'}`,
  ].join('\n');
}
