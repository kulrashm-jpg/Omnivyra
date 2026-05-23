import type {
  ExecutorVerificationContractReport,
  SectionExecutorVerificationContract,
} from './executorVerificationContracts';
import type { RegenerationExecutionManifest } from './regenerationExecutionManifest';
import type { RecoveryExecutionDryRunPlan } from './recoveryExecutionDryRunPlanner';
import type { RecoveryExecutorContractReport } from './recoveryExecutorContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type VerificationCoverageStatus = 'sufficient' | 'partial' | 'insufficient';
export type VerificationCoverageConfidence = 'low' | 'medium' | 'high';

export interface SectionVerificationCoverage {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  coverageStatus: VerificationCoverageStatus;
  preservationCoverage: boolean;
  boundaryCoverage: boolean;
  dependencyCoverage: boolean;
  narrativeCoverage: boolean;
  authorityCoverage: boolean;
  antiRepetitionCoverage: boolean;
  recoveryCoverage: boolean;
  coverageGaps: readonly string[];
}

export interface VerificationReadinessObservation {
  version: 'verification-readiness-observer-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallVerificationCoverage: VerificationCoverageStatus;
  verificationCoverageStatus: VerificationCoverageStatus;
  verificationCompletenessSignals: readonly string[];
  preservationCoverageSignals: readonly string[];
  boundaryCoverageSignals: readonly string[];
  dependencyCoverageSignals: readonly string[];
  narrativeCoverageSignals: readonly string[];
  authorityCoverageSignals: readonly string[];
  antiRepetitionCoverageSignals: readonly string[];
  recoveryCoverageSignals: readonly string[];
  sectionVerificationCoverage: readonly SectionVerificationCoverage[];
  verificationGapSignals: readonly string[];
  verificationCoverageConfidence: VerificationCoverageConfidence;
}

export interface VerificationReadinessObserverInput {
  executorVerificationContracts: ExecutorVerificationContractReport;
  recoveryExecutorContracts: RecoveryExecutorContractReport;
  recoveryExecutionDryRun: RecoveryExecutionDryRunPlan;
  regenerationExecutionManifest: RegenerationExecutionManifest;
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

function has(values: readonly string[]): boolean {
  return values.length > 0;
}

function sectionCoverageStatus(gaps: readonly string[]): VerificationCoverageStatus {
  if (gaps.length === 0) return 'sufficient';
  if (gaps.length <= 2) return 'partial';
  return 'insufficient';
}

function sectionCoverage(section: SectionExecutorVerificationContract): SectionVerificationCoverage {
  const checks = {
    preservationCoverage: has(section.preservationChecks),
    boundaryCoverage: has(section.boundaryChecks),
    dependencyCoverage: has(section.dependencyChecks),
    narrativeCoverage: has(section.narrativeChecks),
    authorityCoverage: has(section.authorityChecks),
    antiRepetitionCoverage: has(section.antiRepetitionChecks),
    recoveryCoverage: has(section.recoveryChecks),
  };
  const coverageGaps = unique([
    ...(!checks.preservationCoverage ? ['missing preservation coverage'] : []),
    ...(!checks.boundaryCoverage ? ['missing boundary coverage'] : []),
    ...(!checks.dependencyCoverage ? ['missing dependency coverage'] : []),
    ...(!checks.narrativeCoverage ? ['missing narrative coverage'] : []),
    ...(!checks.authorityCoverage ? ['missing authority coverage'] : []),
    ...(!checks.antiRepetitionCoverage ? ['missing anti-repetition coverage'] : []),
    ...(!checks.recoveryCoverage ? ['missing recovery coverage'] : []),
  ], 10);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    coverageStatus: sectionCoverageStatus(coverageGaps),
    ...checks,
    coverageGaps,
  };
}

function overallStatus(sections: readonly SectionVerificationCoverage[], globalGaps: readonly string[]): VerificationCoverageStatus {
  if (globalGaps.length > 2 || sections.some((section) => section.coverageStatus === 'insufficient')) return 'insufficient';
  if (globalGaps.length > 0 || sections.some((section) => section.coverageStatus === 'partial')) return 'partial';
  return 'sufficient';
}

function confidence(input: VerificationReadinessObserverInput, status: VerificationCoverageStatus): VerificationCoverageConfidence {
  if (
    status === 'sufficient'
    && input.executorVerificationContracts.verificationConfidence === 'high'
    && input.recoveryExecutionDryRun.dryRunConfidence !== 'low'
  ) return 'high';
  if (status === 'insufficient' || input.executorVerificationContracts.verificationConfidence === 'low') return 'low';
  return 'medium';
}

export function observeVerificationReadiness(input: VerificationReadinessObserverInput): VerificationReadinessObservation {
  const contracts = input.executorVerificationContracts;
  const sectionVerificationCoverage = contracts.sectionVerificationContracts.map(sectionCoverage);
  const globalGaps = unique([
    ...(!has(contracts.verificationInputRequirements) ? ['missing verification input requirements'] : []),
    ...(!has(contracts.verificationOutputRequirements) ? ['missing verification output requirements'] : []),
    ...(!has(contracts.verificationPreservationChecks) ? ['missing global preservation checks'] : []),
    ...(!has(contracts.verificationBoundaryChecks) ? ['missing global boundary checks'] : []),
    ...(!has(contracts.verificationDependencyChecks) ? ['missing global dependency checks'] : []),
    ...(!has(contracts.verificationNarrativeChecks) ? ['missing narrative stability checks'] : []),
    ...(!has(contracts.verificationAuthorityChecks) ? ['missing authority checks'] : []),
    ...(!has(contracts.verificationAntiRepetitionChecks) ? ['missing anti-repetition checks'] : []),
    ...(!has(contracts.verificationRecoveryChecks) ? ['missing recovery checks'] : []),
    ...sectionVerificationCoverage.flatMap((section) => section.coverageGaps.map((gap) => `section ${section.sectionIndex}: ${gap}`)),
  ], 24);
  const verificationCoverageStatus = overallStatus(sectionVerificationCoverage, globalGaps);

  return {
    version: 'verification-readiness-observer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: contracts.contentType,
    topic: contracts.topic,
    overallVerificationCoverage: verificationCoverageStatus,
    verificationCoverageStatus,
    verificationCompletenessSignals: unique([
      `input requirements: ${contracts.verificationInputRequirements.length}`,
      `output requirements: ${contracts.verificationOutputRequirements.length}`,
      `section verification contracts: ${contracts.sectionVerificationContracts.length}`,
      `executor section contracts: ${input.recoveryExecutorContracts.sectionExecutorContracts.length}`,
      `execution manifest sections: ${input.regenerationExecutionManifest.sectionExecutionManifests.length}`,
    ], 10),
    preservationCoverageSignals: unique(contracts.verificationPreservationChecks, 12),
    boundaryCoverageSignals: unique(contracts.verificationBoundaryChecks, 12),
    dependencyCoverageSignals: unique(contracts.verificationDependencyChecks, 12),
    narrativeCoverageSignals: unique(contracts.verificationNarrativeChecks, 12),
    authorityCoverageSignals: unique(contracts.verificationAuthorityChecks, 12),
    antiRepetitionCoverageSignals: unique(contracts.verificationAntiRepetitionChecks, 12),
    recoveryCoverageSignals: unique(contracts.verificationRecoveryChecks, 12),
    sectionVerificationCoverage,
    verificationGapSignals: globalGaps,
    verificationCoverageConfidence: confidence(input, verificationCoverageStatus),
  };
}

export function serializeVerificationReadinessObservation(observation: VerificationReadinessObservation): string {
  return [
    '## VERIFICATION READINESS OBSERVATION',
    `Version: ${observation.version}`,
    `Topic: ${observation.topic}`,
    `Content type: ${observation.contentType}`,
    `Coverage status: ${observation.verificationCoverageStatus}`,
    `Coverage confidence: ${observation.verificationCoverageConfidence}`,
    `Section coverage entries: ${observation.sectionVerificationCoverage.length}`,
    `Gap signals: ${observation.verificationGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
