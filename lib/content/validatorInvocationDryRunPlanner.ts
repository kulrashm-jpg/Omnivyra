import type {
  SectionExecutionAdapter,
  ValidatorExecutionAdapterContract,
} from './validatorExecutionAdapterContract';
import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionPreparation } from './validatorExecutionPreparation';
import type { ValidatorOperationalReadiness } from './validatorOperationalReadiness';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorInvocationDryRunReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorInvocationDryRunEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorInvocationDryRunConfidence = 'low' | 'medium' | 'high';

export interface SectionInvocationDryRun {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  invocationReadiness: ValidatorInvocationDryRunReadiness;
  invocationEligibility: ValidatorInvocationDryRunEligibility;
  invocationSequencePosition: number;
  dependencySimulation: readonly string[];
  boundarySimulation: readonly string[];
  preservationSimulation: readonly string[];
  executionSimulation: readonly string[];
  riskSimulation: readonly string[];
  gapSignals: readonly string[];
}

export interface ValidatorInvocationDryRunPlan {
  version: 'validator-invocation-dry-run-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallInvocationDryRunReadiness: ValidatorInvocationDryRunReadiness;
  invocationDryRunEligibility: ValidatorInvocationDryRunEligibility;
  invocationDryRunSequence: readonly number[];
  invocationDependencySimulation: readonly string[];
  invocationBoundarySimulation: readonly string[];
  invocationPreservationSimulation: readonly string[];
  invocationExecutionSimulation: readonly string[];
  invocationRiskSimulation: readonly string[];
  invocationGapSignals: readonly string[];
  sectionInvocationDryRuns: readonly SectionInvocationDryRun[];
  invocationDryRunConfidence: ValidatorInvocationDryRunConfidence;
}

export interface ValidatorInvocationDryRunInput {
  validatorExecutionAdapterContract: ValidatorExecutionAdapterContract;
  validatorPreflightReadinessGate: ValidatorPreflightReadinessGate;
  validatorOperationalReadiness: ValidatorOperationalReadiness;
  validatorExecutionPreparation: ValidatorExecutionPreparation;
  validatorDecisionTrace: ValidatorDecisionTrace;
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

function readinessFromSignals(
  baseReadiness: ValidatorInvocationDryRunReadiness,
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorInvocationDryRunReadiness {
  if (baseReadiness === 'blocked' || gapSignals.length > 3) return 'blocked';
  if (baseReadiness === 'conditional' || riskSignals.length > 0 || gapSignals.length > 0) return 'conditional';
  return 'ready';
}

function eligibility(readiness: ValidatorInvocationDryRunReadiness): ValidatorInvocationDryRunEligibility {
  if (readiness === 'blocked') return 'not_recommended';
  if (readiness === 'conditional') return 'deferred';
  return 'eligible';
}

function confidence(
  readiness: ValidatorInvocationDryRunReadiness,
  input: ValidatorInvocationDryRunInput,
): ValidatorInvocationDryRunConfidence {
  if (
    readiness === 'ready'
    && input.validatorExecutionAdapterContract.executionAdapterConfidence === 'high'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
  ) return 'high';
  if (
    readiness === 'blocked'
    || input.validatorExecutionAdapterContract.executionAdapterConfidence === 'low'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorInvocationDryRunInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function preparationFor(input: ValidatorInvocationDryRunInput, sectionIndex: number) {
  return input.validatorExecutionPreparation.sectionExecutionPreparation.find((section) => section.sectionIndex === sectionIndex);
}

function sectionDryRun(
  input: ValidatorInvocationDryRunInput,
  section: SectionExecutionAdapter,
  index: number,
): SectionInvocationDryRun {
  const trace = traceFor(input, section.sectionIndex);
  const preparation = preparationFor(input, section.sectionIndex);
  const gapSignals = unique([
    ...section.adapterGapSignals,
    ...(section.adapterDependencies.length === 0 ? ['missing invocation dependency simulation'] : []),
    ...(section.adapterBoundaries.length === 0 ? ['missing invocation boundary simulation'] : []),
    ...(section.adapterPreservationRequirements.length === 0 ? ['missing invocation preservation simulation'] : []),
    ...(section.adapterExecutionRequirements.length === 0 ? ['missing invocation execution simulation'] : []),
  ], 10);
  const riskSignals = unique([
    ...section.adapterRiskSignals,
    ...(preparation?.risks || []),
  ], 10);
  const invocationReadiness = readinessFromSignals(
    section.executionAdapterEligibility === 'not_recommended'
      ? 'blocked'
      : section.executionAdapterEligibility === 'deferred'
        ? 'conditional'
        : 'ready',
    riskSignals,
    gapSignals,
  );

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    invocationReadiness,
    invocationEligibility: eligibility(invocationReadiness),
    invocationSequencePosition: index,
    dependencySimulation: unique([
      ...section.adapterDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    boundarySimulation: unique([
      ...section.adapterBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    preservationSimulation: unique([
      ...section.adapterPreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    executionSimulation: unique([
      ...section.adapterExecutionRequirements,
      ...(preparation?.executionPreparationSignals || []),
      'simulate adapter handoff without validator execution',
    ], 12),
    riskSimulation: riskSignals,
    gapSignals,
  };
}

function globalGaps(input: ValidatorInvocationDryRunInput): string[] {
  return unique([
    ...(input.validatorExecutionAdapterContract.executionAdapterInputs.length === 0 ? ['missing adapter input expectations'] : []),
    ...(input.validatorExecutionAdapterContract.executionAdapterOutputs.length === 0 ? ['missing adapter output expectations'] : []),
    ...(input.validatorExecutionAdapterContract.executionAdapterDependencies.length === 0 ? ['missing adapter dependency expectations'] : []),
    ...(input.validatorExecutionAdapterContract.executionAdapterBoundaries.length === 0 ? ['missing adapter boundary expectations'] : []),
    ...(input.validatorExecutionAdapterContract.executionAdapterPreservationRequirements.length === 0 ? ['missing adapter preservation expectations'] : []),
    ...(input.validatorExecutionAdapterContract.executionAdapterExecutionRequirements.length === 0 ? ['missing adapter execution requirements'] : []),
    ...input.validatorExecutionAdapterContract.executionAdapterGapSignals,
  ], 18);
}

export function planValidatorInvocationDryRun(input: ValidatorInvocationDryRunInput): ValidatorInvocationDryRunPlan {
  const sectionInvocationDryRuns = input.validatorExecutionAdapterContract.sectionExecutionAdapters.map((section, index) => {
    return sectionDryRun(input, section, index);
  });
  const invocationGapSignals = unique([
    ...globalGaps(input),
    ...sectionInvocationDryRuns.flatMap((section) => section.gapSignals.map((gap) => `section ${section.sectionIndex}: ${gap}`)),
  ], 24);
  const invocationRiskSimulation = unique([
    ...input.validatorExecutionAdapterContract.executionAdapterRiskSignals,
    ...input.validatorOperationalReadiness.operationalGapSignals,
    ...sectionInvocationDryRuns.flatMap((section) => section.riskSimulation),
  ], 18);
  const overallInvocationDryRunReadiness = readinessFromSignals(
    input.validatorExecutionAdapterContract.overallExecutionAdapterReadiness,
    invocationRiskSimulation,
    invocationGapSignals,
  );

  return {
    version: 'validator-invocation-dry-run-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorExecutionAdapterContract.contentType,
    topic: input.validatorExecutionAdapterContract.topic,
    overallInvocationDryRunReadiness,
    invocationDryRunEligibility: eligibility(overallInvocationDryRunReadiness),
    invocationDryRunSequence: sectionInvocationDryRuns.map((section) => section.sectionIndex),
    invocationDependencySimulation: unique([
      ...input.validatorExecutionAdapterContract.executionAdapterDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    invocationBoundarySimulation: unique([
      ...input.validatorExecutionAdapterContract.executionAdapterBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    invocationPreservationSimulation: unique([
      ...input.validatorExecutionAdapterContract.executionAdapterPreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    invocationExecutionSimulation: unique([
      ...input.validatorExecutionAdapterContract.executionAdapterExecutionRequirements,
      ...input.validatorExecutionPreparation.executionPreparationSignals,
      'dry-run only: do not invoke validators',
    ], 18),
    invocationRiskSimulation,
    invocationGapSignals,
    sectionInvocationDryRuns,
    invocationDryRunConfidence: confidence(overallInvocationDryRunReadiness, input),
  };
}

export function serializeValidatorInvocationDryRunPlan(plan: ValidatorInvocationDryRunPlan): string {
  return [
    '## VALIDATOR INVOCATION DRY RUN',
    `Version: ${plan.version}`,
    `Topic: ${plan.topic}`,
    `Content type: ${plan.contentType}`,
    `Invocation readiness: ${plan.overallInvocationDryRunReadiness}`,
    `Invocation eligibility: ${plan.invocationDryRunEligibility}`,
    `Invocation confidence: ${plan.invocationDryRunConfidence}`,
    `Invocation sequence: ${plan.invocationDryRunSequence.join(', ') || 'none'}`,
    `Gap signals: ${plan.invocationGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
