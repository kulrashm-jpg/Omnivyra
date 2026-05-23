import type { ValidatorCoverageLedger } from './validatorCoverageLedger';
import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionPreparation, SectionExecutionPreparation } from './validatorExecutionPreparation';
import type { ValidatorHandoffManifest } from './validatorHandoffManifest';
import type { ValidatorOperationalReadiness } from './validatorOperationalReadiness';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorPreflightReadinessState = 'ready' | 'conditional' | 'blocked';
export type ValidatorPreflightEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorPreflightConfidence = 'low' | 'medium' | 'high';

export interface SectionPreflightReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  preflightReadiness: ValidatorPreflightReadinessState;
  preflightEligibility: ValidatorPreflightEligibility;
  dependencyCoverage: readonly string[];
  boundaryCoverage: readonly string[];
  preservationCoverage: readonly string[];
  executionCoverage: readonly string[];
  gapSignals: readonly string[];
}

export interface ValidatorPreflightReadinessGate {
  version: 'validator-preflight-readiness-gate-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallPreflightReadiness: ValidatorPreflightReadinessState;
  preflightEligibility: ValidatorPreflightEligibility;
  preflightDependencyCoverage: readonly string[];
  preflightBoundaryCoverage: readonly string[];
  preflightPreservationCoverage: readonly string[];
  preflightExecutionCoverage: readonly string[];
  preflightRiskSignals: readonly string[];
  preflightGapSignals: readonly string[];
  sectionPreflightReadiness: readonly SectionPreflightReadiness[];
  preflightConfidence: ValidatorPreflightConfidence;
}

export interface ValidatorPreflightReadinessGateInput {
  validatorOperationalReadiness: ValidatorOperationalReadiness;
  validatorExecutionPreparation: ValidatorExecutionPreparation;
  validatorHandoffManifest: ValidatorHandoffManifest;
  validatorDecisionTrace: ValidatorDecisionTrace;
  validatorCoverageLedger: ValidatorCoverageLedger;
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

function readinessFromGaps(
  baseReadiness: ValidatorPreflightReadinessState,
  gaps: readonly string[],
): ValidatorPreflightReadinessState {
  if (baseReadiness === 'blocked' || gaps.length > 3) return 'blocked';
  if (baseReadiness === 'conditional' || gaps.length > 0) return 'conditional';
  return 'ready';
}

function eligibility(readiness: ValidatorPreflightReadinessState): ValidatorPreflightEligibility {
  if (readiness === 'blocked') return 'not_recommended';
  if (readiness === 'conditional') return 'deferred';
  return 'eligible';
}

function confidence(
  readiness: ValidatorPreflightReadinessState,
  input: ValidatorPreflightReadinessGateInput,
): ValidatorPreflightConfidence {
  if (
    readiness === 'ready'
    && input.validatorOperationalReadiness.operationalReadinessConfidence === 'high'
    && input.validatorExecutionPreparation.executionPreparationConfidence === 'high'
  ) return 'high';
  if (
    readiness === 'blocked'
    || input.validatorOperationalReadiness.operationalReadinessConfidence === 'low'
    || input.validatorExecutionPreparation.executionPreparationConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPreflight(
  input: ValidatorPreflightReadinessGateInput,
  section: SectionExecutionPreparation,
): SectionPreflightReadiness {
  const operational = input.validatorOperationalReadiness.sectionOperationalReadiness.find((item) => item.sectionIndex === section.sectionIndex);
  const gapSignals = unique([
    ...(section.dependencies.length === 0 ? ['missing section dependency coverage'] : []),
    ...(section.boundaries.length === 0 ? ['missing section boundary coverage'] : []),
    ...(section.preservationSignals.length === 0 ? ['missing section preservation coverage'] : []),
    ...(section.executionPreparationSignals.length === 0 ? ['missing section execution preparation coverage'] : []),
    ...(operational?.operationalGapSignals || []),
    ...section.risks,
  ], 10);
  const baseReadiness = operational?.operationalReadiness || input.validatorOperationalReadiness.overallOperationalReadiness;
  const preflightReadiness = readinessFromGaps(baseReadiness, gapSignals);

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    preflightReadiness,
    preflightEligibility: eligibility(preflightReadiness),
    dependencyCoverage: unique([
      ...section.dependencies,
      ...(operational?.operationalDependencySignals || []),
    ], 10),
    boundaryCoverage: unique([
      ...section.boundaries,
      ...(operational?.operationalBoundaryCoverage || []),
    ], 10),
    preservationCoverage: unique([
      ...section.preservationSignals,
      ...(operational?.operationalPreservationCoverage || []),
    ], 10),
    executionCoverage: unique([
      ...section.executionPreparationSignals,
      ...(operational?.operationalCoverageSignals || []),
    ], 10),
    gapSignals,
  };
}

function globalGaps(input: ValidatorPreflightReadinessGateInput): string[] {
  return unique([
    ...(input.validatorOperationalReadiness.operationalDependencySignals.length === 0 ? ['missing operational dependency coverage'] : []),
    ...(input.validatorOperationalReadiness.operationalBoundaryCoverage.length === 0 ? ['missing operational boundary coverage'] : []),
    ...(input.validatorOperationalReadiness.operationalPreservationCoverage.length === 0 ? ['missing operational preservation coverage'] : []),
    ...(input.validatorExecutionPreparation.executionPreparationSignals.length === 0 ? ['missing execution preparation signals'] : []),
    ...(input.validatorHandoffManifest.handoffExecutionPayload.length === 0 ? ['missing handoff execution payload'] : []),
    ...(input.validatorDecisionTrace.decisionTraceSequence.length === 0 ? ['missing decision trace sequence'] : []),
    ...(input.validatorCoverageLedger.coverageLedgerEntries.length === 0 ? ['missing coverage ledger entries'] : []),
  ], 18);
}

export function evaluateValidatorPreflightReadiness(
  input: ValidatorPreflightReadinessGateInput,
): ValidatorPreflightReadinessGate {
  const sectionPreflightReadiness = input.validatorExecutionPreparation.sectionExecutionPreparation.map((section) => sectionPreflight(input, section));
  const preflightGapSignals = unique([
    ...globalGaps(input),
    ...sectionPreflightReadiness.flatMap((section) => section.gapSignals.map((gap) => `section ${section.sectionIndex}: ${gap}`)),
  ], 24);
  const baseReadiness = input.validatorOperationalReadiness.overallOperationalReadiness;
  const overallPreflightReadiness = readinessFromGaps(baseReadiness, preflightGapSignals);

  return {
    version: 'validator-preflight-readiness-gate-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorOperationalReadiness.contentType,
    topic: input.validatorOperationalReadiness.topic,
    overallPreflightReadiness,
    preflightEligibility: eligibility(overallPreflightReadiness),
    preflightDependencyCoverage: unique([
      ...input.validatorOperationalReadiness.operationalDependencySignals,
      ...input.validatorExecutionPreparation.executionPreparationDependencies,
    ], 18),
    preflightBoundaryCoverage: unique([
      ...input.validatorOperationalReadiness.operationalBoundaryCoverage,
      ...input.validatorHandoffManifest.handoffBoundaryRequirements,
    ], 18),
    preflightPreservationCoverage: unique([
      ...input.validatorOperationalReadiness.operationalPreservationCoverage,
      ...input.validatorHandoffManifest.handoffPreservationRequirements,
    ], 18),
    preflightExecutionCoverage: unique([
      ...input.validatorExecutionPreparation.executionPreparationSignals,
      ...input.validatorHandoffManifest.handoffExecutionPayload,
    ], 18),
    preflightRiskSignals: unique([
      ...input.validatorOperationalReadiness.operationalGapSignals,
      ...input.validatorExecutionPreparation.executionPreparationRisks,
      ...input.validatorDecisionTrace.decisionTraceRiskSignals,
    ], 18),
    preflightGapSignals,
    sectionPreflightReadiness,
    preflightConfidence: confidence(overallPreflightReadiness, input),
  };
}

export function serializeValidatorPreflightReadinessGate(gate: ValidatorPreflightReadinessGate): string {
  return [
    '## VALIDATOR PREFLIGHT READINESS GATE',
    `Version: ${gate.version}`,
    `Topic: ${gate.topic}`,
    `Content type: ${gate.contentType}`,
    `Preflight readiness: ${gate.overallPreflightReadiness}`,
    `Preflight eligibility: ${gate.preflightEligibility}`,
    `Preflight confidence: ${gate.preflightConfidence}`,
    `Section preflight entries: ${gate.sectionPreflightReadiness.length}`,
    `Gap signals: ${gate.preflightGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
