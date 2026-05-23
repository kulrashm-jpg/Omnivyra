import type { ValidatorCoverageLedger } from './validatorCoverageLedger';
import type { ValidatorExecutionPreparation, SectionExecutionPreparation } from './validatorExecutionPreparation';
import type { ValidatorHandoffManifest } from './validatorHandoffManifest';
import type { ValidatorHandoffReadiness } from './validatorHandoffReadiness';
import type { ValidatorReviewSnapshot } from './validatorReviewSnapshotAssembler';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorOperationalReadinessState = 'ready' | 'conditional' | 'blocked';
export type ValidatorOperationalReadinessConfidence = 'low' | 'medium' | 'high';

export interface SectionOperationalReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  operationalReadiness: ValidatorOperationalReadinessState;
  operationalCoverageSignals: readonly string[];
  operationalDependencySignals: readonly string[];
  operationalBoundaryCoverage: readonly string[];
  operationalPreservationCoverage: readonly string[];
  operationalGapSignals: readonly string[];
}

export interface ValidatorOperationalReadiness {
  version: 'validator-operational-readiness-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallOperationalReadiness: ValidatorOperationalReadinessState;
  operationalCoverageSignals: readonly string[];
  operationalDependencySignals: readonly string[];
  operationalBoundaryCoverage: readonly string[];
  operationalPreservationCoverage: readonly string[];
  operationalGapSignals: readonly string[];
  sectionOperationalReadiness: readonly SectionOperationalReadiness[];
  operationalReadinessConfidence: ValidatorOperationalReadinessConfidence;
}

export interface ValidatorOperationalReadinessInput {
  validatorExecutionPreparation: ValidatorExecutionPreparation;
  validatorHandoffManifest: ValidatorHandoffManifest;
  validatorHandoffReadiness: ValidatorHandoffReadiness;
  validatorCoverageLedger: ValidatorCoverageLedger;
  validatorReviewSnapshot: ValidatorReviewSnapshot;
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

function readiness(input: ValidatorOperationalReadinessInput): ValidatorOperationalReadinessState {
  if (
    input.validatorExecutionPreparation.overallExecutionPreparationReadiness === 'blocked'
    || input.validatorHandoffManifest.overallHandoffManifestReadiness === 'blocked'
    || input.validatorHandoffReadiness.overallHandoffReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorExecutionPreparation.overallExecutionPreparationReadiness === 'conditional'
    || input.validatorHandoffManifest.overallHandoffManifestReadiness === 'conditional'
    || input.validatorHandoffReadiness.overallHandoffReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorOperationalReadinessState, input: ValidatorOperationalReadinessInput): ValidatorOperationalReadinessConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorExecutionPreparation.executionPreparationConfidence === 'high'
    && input.validatorCoverageLedger.coverageLedgerConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorExecutionPreparation.executionPreparationConfidence === 'low'
    || input.validatorCoverageLedger.coverageLedgerConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionReadiness(section: SectionExecutionPreparation): SectionOperationalReadiness {
  const gapSignals = unique([
    ...section.risks,
    ...(section.boundaries.length === 0 ? ['missing operational boundary coverage'] : []),
    ...(section.preservationSignals.length === 0 ? ['missing operational preservation coverage'] : []),
  ], 8);
  const operationalReadiness: ValidatorOperationalReadinessState = gapSignals.length > 1
    ? 'blocked'
    : gapSignals.length > 0 || section.executionPreparationEligibility !== 'eligible'
      ? 'conditional'
      : 'ready';
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    operationalReadiness,
    operationalCoverageSignals: unique(section.executionPreparationSignals, 8),
    operationalDependencySignals: unique(section.dependencies, 8),
    operationalBoundaryCoverage: unique(section.boundaries, 8),
    operationalPreservationCoverage: unique(section.preservationSignals, 8),
    operationalGapSignals: gapSignals,
  };
}

export function observeValidatorOperationalReadiness(input: ValidatorOperationalReadinessInput): ValidatorOperationalReadiness {
  const overallOperationalReadiness = readiness(input);
  const sectionOperationalReadiness = input.validatorExecutionPreparation.sectionExecutionPreparation.map(sectionReadiness);
  const operationalGapSignals = unique([
    ...input.validatorExecutionPreparation.executionPreparationRisks,
    ...sectionOperationalReadiness.flatMap((section) => section.operationalGapSignals.map((gap) => `section ${section.sectionIndex}: ${gap}`)),
  ], 18);

  return {
    version: 'validator-operational-readiness-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorExecutionPreparation.contentType,
    topic: input.validatorExecutionPreparation.topic,
    overallOperationalReadiness,
    operationalCoverageSignals: unique([
      ...input.validatorExecutionPreparation.executionPreparationSignals,
      ...input.validatorCoverageLedger.coverageLedgerEntries,
      ...input.validatorReviewSnapshot.reviewSnapshots,
    ], 18),
    operationalDependencySignals: unique(input.validatorExecutionPreparation.executionPreparationDependencies, 18),
    operationalBoundaryCoverage: unique(input.validatorExecutionPreparation.executionPreparationBoundaries, 18),
    operationalPreservationCoverage: unique(input.validatorExecutionPreparation.executionPreparationPreservationSignals, 18),
    operationalGapSignals,
    sectionOperationalReadiness,
    operationalReadinessConfidence: confidence(overallOperationalReadiness, input),
  };
}

export function serializeValidatorOperationalReadiness(readinessReport: ValidatorOperationalReadiness): string {
  return [
    '## VALIDATOR OPERATIONAL READINESS',
    `Version: ${readinessReport.version}`,
    `Topic: ${readinessReport.topic}`,
    `Content type: ${readinessReport.contentType}`,
    `Operational readiness: ${readinessReport.overallOperationalReadiness}`,
    `Operational confidence: ${readinessReport.operationalReadinessConfidence}`,
    `Section operational entries: ${readinessReport.sectionOperationalReadiness.length}`,
    `Boundary coverage: ${readinessReport.operationalBoundaryCoverage.length}`,
    `Preservation coverage: ${readinessReport.operationalPreservationCoverage.length}`,
  ].join('\n');
}
