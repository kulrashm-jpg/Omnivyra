import type { ValidatorAuditTrail } from './validatorAuditTrail';
import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorHandoffManifest, SectionHandoffPayload } from './validatorHandoffManifest';
import type { ValidatorHandoffReadiness } from './validatorHandoffReadiness';
import type { ValidatorRecoveryDecisionSequence } from './validatorRecoveryDecisionSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorExecutionPreparationReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorExecutionPreparationConfidence = 'low' | 'medium' | 'high';

export interface SectionExecutionPreparation {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executionPreparationEligibility: SectionHandoffPayload['handoffEligibility'];
  executionPreparationSignals: readonly string[];
  dependencies: readonly string[];
  boundaries: readonly string[];
  preservationSignals: readonly string[];
  risks: readonly string[];
}

export interface ValidatorExecutionPreparation {
  version: 'validator-execution-preparation-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallExecutionPreparationReadiness: ValidatorExecutionPreparationReadiness;
  executionPreparationSignals: readonly string[];
  executionPreparationDependencies: readonly string[];
  executionPreparationBoundaries: readonly string[];
  executionPreparationPreservationSignals: readonly string[];
  executionPreparationRisks: readonly string[];
  sectionExecutionPreparation: readonly SectionExecutionPreparation[];
  executionPreparationConfidence: ValidatorExecutionPreparationConfidence;
}

export interface ValidatorExecutionPreparationInput {
  validatorHandoffManifest: ValidatorHandoffManifest;
  validatorHandoffReadiness: ValidatorHandoffReadiness;
  validatorDecisionTrace: ValidatorDecisionTrace;
  validatorCoverageLedger: import('./validatorCoverageLedger').ValidatorCoverageLedger;
  validatorAuditTrail: ValidatorAuditTrail;
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
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

function readiness(input: ValidatorExecutionPreparationInput): ValidatorExecutionPreparationReadiness {
  if (
    input.validatorHandoffManifest.overallHandoffManifestReadiness === 'blocked'
    || input.validatorHandoffReadiness.overallHandoffReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorHandoffManifest.overallHandoffManifestReadiness === 'conditional'
    || input.validatorHandoffReadiness.overallHandoffReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorExecutionPreparationReadiness, input: ValidatorExecutionPreparationInput): ValidatorExecutionPreparationConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorHandoffManifest.handoffManifestConfidence === 'high'
    && input.validatorHandoffReadiness.handoffConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorHandoffManifest.handoffManifestConfidence === 'low'
    || input.validatorHandoffReadiness.handoffConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPreparation(section: SectionHandoffPayload): SectionExecutionPreparation {
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    executionPreparationEligibility: section.handoffEligibility,
    executionPreparationSignals: unique(section.handoffPayload, 8),
    dependencies: unique(section.dependencyRequirements, 10),
    boundaries: unique(section.boundaryRequirements, 10),
    preservationSignals: unique(section.preservationRequirements, 10),
    risks: unique([
      ...section.reviewRequirements.filter((requirement) => /risk|defer|non-mutating/i.test(requirement)),
      ...(section.handoffEligibility === 'eligible' ? [] : [`execution preparation deferred: ${section.handoffEligibility}`]),
    ], 8),
  };
}

export function prepareValidatorExecution(input: ValidatorExecutionPreparationInput): ValidatorExecutionPreparation {
  const overallExecutionPreparationReadiness = readiness(input);
  const sectionExecutionPreparation = input.validatorHandoffManifest.sectionHandoffPayloads.map(sectionPreparation);

  return {
    version: 'validator-execution-preparation-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorHandoffManifest.contentType,
    topic: input.validatorHandoffManifest.topic,
    overallExecutionPreparationReadiness,
    executionPreparationSignals: unique([
      `handoff readiness: ${input.validatorHandoffReadiness.overallHandoffReadiness}`,
      `handoff manifest readiness: ${input.validatorHandoffManifest.overallHandoffManifestReadiness}`,
      `decision trace readiness: ${input.validatorDecisionTrace.overallDecisionTraceReadiness}`,
      'validator execution preparation remains non-executing',
    ], 10),
    executionPreparationDependencies: unique([
      ...input.validatorHandoffManifest.handoffDependencyRequirements,
      ...input.validatorRecoveryDecisionSequence.recoveryDependencyOrdering,
    ], 18),
    executionPreparationBoundaries: unique(input.validatorHandoffManifest.handoffBoundaryRequirements, 18),
    executionPreparationPreservationSignals: unique(input.validatorHandoffManifest.handoffPreservationRequirements, 18),
    executionPreparationRisks: unique([
      ...input.validatorHandoffReadiness.handoffRiskSignals,
      ...input.validatorAuditTrail.auditDecisionEvents.filter((event) => /defer|risk/i.test(event)),
    ], 18),
    sectionExecutionPreparation,
    executionPreparationConfidence: confidence(overallExecutionPreparationReadiness, input),
  };
}

export function serializeValidatorExecutionPreparation(preparation: ValidatorExecutionPreparation): string {
  return [
    '## VALIDATOR EXECUTION PREPARATION',
    `Version: ${preparation.version}`,
    `Topic: ${preparation.topic}`,
    `Content type: ${preparation.contentType}`,
    `Execution preparation readiness: ${preparation.overallExecutionPreparationReadiness}`,
    `Execution preparation confidence: ${preparation.executionPreparationConfidence}`,
    `Section preparation entries: ${preparation.sectionExecutionPreparation.length}`,
    `Boundary signals: ${preparation.executionPreparationBoundaries.length}`,
    `Preservation signals: ${preparation.executionPreparationPreservationSignals.length}`,
  ].join('\n');
}
