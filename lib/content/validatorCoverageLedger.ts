import type { ValidatorAuditTrail } from './validatorAuditTrail';
import type { ValidatorRecoveryDecisionSequence } from './validatorRecoveryDecisionSequencer';
import type { ValidatorResultContractReport } from './validatorResultContracts';
import type { ValidatorReviewSnapshot } from './validatorReviewSnapshotAssembler';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type CoverageLedgerReadiness = 'ready' | 'conditional' | 'blocked';
export type CoverageLedgerConfidence = 'low' | 'medium' | 'high';

export interface SectionCoverageLedgerEntry {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  coverageLedger: readonly string[];
  boundaryCoverage: readonly string[];
  preservationCoverage: readonly string[];
  decisionCoverage: readonly string[];
  dependencyCoverage: readonly string[];
}

export interface ValidatorCoverageLedger {
  version: 'validator-coverage-ledger-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallCoverageLedgerReadiness: CoverageLedgerReadiness;
  coverageLedgerEntries: readonly string[];
  boundaryCoverageLedger: readonly string[];
  preservationCoverageLedger: readonly string[];
  decisionCoverageLedger: readonly string[];
  dependencyCoverageLedger: readonly string[];
  sectionCoverageLedger: readonly SectionCoverageLedgerEntry[];
  coverageLedgerRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  coverageLedgerConfidence: CoverageLedgerConfidence;
}

export interface ValidatorCoverageLedgerInput {
  validatorReviewSnapshot: ValidatorReviewSnapshot;
  validatorAuditTrail: ValidatorAuditTrail;
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
  validatorResultContracts: ValidatorResultContractReport;
}

function unique(values: readonly string[], limit = 18): string[] {
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

function readiness(input: ValidatorCoverageLedgerInput): CoverageLedgerReadiness {
  if (
    input.validatorReviewSnapshot.overallSnapshotReadiness === 'blocked'
    || input.validatorAuditTrail.overallAuditReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorReviewSnapshot.overallSnapshotReadiness === 'conditional'
    || input.validatorAuditTrail.overallAuditReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: CoverageLedgerReadiness, input: ValidatorCoverageLedgerInput): CoverageLedgerConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorReviewSnapshot.snapshotConfidence === 'high'
    && input.validatorAuditTrail.auditConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorReviewSnapshot.snapshotConfidence === 'low'
    || input.validatorAuditTrail.auditConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionLedger(input: ValidatorCoverageLedgerInput) {
  return input.validatorReviewSnapshot.sectionReviewSnapshots.map((section) => ({
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    coverageLedger: unique(section.reviewSnapshot, 8),
    boundaryCoverage: unique(section.boundarySnapshot, 8),
    preservationCoverage: unique(section.preservationSnapshot, 8),
    decisionCoverage: unique(section.decisionSnapshot, 8),
    dependencyCoverage: unique(
      input.validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans
        .find((plan) => plan.sectionIndex === section.sectionIndex)?.dependencySignals || [],
      8,
    ),
  }));
}

export function buildValidatorCoverageLedger(input: ValidatorCoverageLedgerInput): ValidatorCoverageLedger {
  const overallCoverageLedgerReadiness = readiness(input);
  const sectionCoverageLedger = sectionLedger(input);

  return {
    version: 'validator-coverage-ledger-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorReviewSnapshot.contentType,
    topic: input.validatorReviewSnapshot.topic,
    overallCoverageLedgerReadiness,
    coverageLedgerEntries: unique([
      ...input.validatorReviewSnapshot.reviewSnapshots,
      `result preservation requirements: ${input.validatorResultContracts.validatorResultPreservationRequirements.length}`,
      `result boundary requirements: ${input.validatorResultContracts.validatorResultBoundaries.length}`,
    ], 16),
    boundaryCoverageLedger: unique(input.validatorReviewSnapshot.reviewBoundarySnapshots, 18),
    preservationCoverageLedger: unique(input.validatorReviewSnapshot.reviewPreservationSnapshots, 18),
    decisionCoverageLedger: unique(input.validatorReviewSnapshot.reviewDecisionSnapshots, 18),
    dependencyCoverageLedger: unique(input.validatorAuditTrail.auditDependencyEvents, 18),
    sectionCoverageLedger,
    coverageLedgerRiskProfile: {
      lowRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.lowRisk,
      mediumRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.mediumRisk,
      highRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.highRisk,
      gaps: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.gaps,
      deferred: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.deferred,
    },
    coverageLedgerConfidence: confidence(overallCoverageLedgerReadiness, input),
  };
}

export function serializeValidatorCoverageLedger(ledger: ValidatorCoverageLedger): string {
  return [
    '## VALIDATOR COVERAGE LEDGER',
    `Version: ${ledger.version}`,
    `Topic: ${ledger.topic}`,
    `Content type: ${ledger.contentType}`,
    `Coverage readiness: ${ledger.overallCoverageLedgerReadiness}`,
    `Coverage confidence: ${ledger.coverageLedgerConfidence}`,
    `Coverage entries: ${ledger.coverageLedgerEntries.length}`,
    `Section ledger entries: ${ledger.sectionCoverageLedger.length}`,
    `Dependency coverage: ${ledger.dependencyCoverageLedger.length}`,
  ].join('\n');
}
