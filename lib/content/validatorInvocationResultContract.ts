import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionAdapterContract, SectionExecutionAdapter } from './validatorExecutionAdapterContract';
import type { ValidatorInvocationDryRunPlan } from './validatorInvocationDryRunPlanner';
import type { ValidatorOperationalReadiness } from './validatorOperationalReadiness';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorInvocationResultReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorInvocationResultEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorInvocationResultConfidence = 'low' | 'medium' | 'high';

export interface SectionInvocationResult {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  invocationResultEligibility: ValidatorInvocationResultEligibility;
  resultInputs: readonly string[];
  resultOutputs: readonly string[];
  resultDependencies: readonly string[];
  resultBoundaries: readonly string[];
  resultPreservationRequirements: readonly string[];
  resultVerificationRequirements: readonly string[];
  resultRiskSignals: readonly string[];
  resultGapSignals: readonly string[];
}

export interface ValidatorInvocationResultContract {
  version: 'validator-invocation-result-contract-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallInvocationResultReadiness: ValidatorInvocationResultReadiness;
  invocationResultEligibility: ValidatorInvocationResultEligibility;
  invocationResultInputs: readonly string[];
  invocationResultOutputs: readonly string[];
  invocationResultDependencies: readonly string[];
  invocationResultBoundaries: readonly string[];
  invocationResultPreservationRequirements: readonly string[];
  invocationResultVerificationRequirements: readonly string[];
  invocationResultRiskSignals: readonly string[];
  invocationResultGapSignals: readonly string[];
  sectionInvocationResults: readonly SectionInvocationResult[];
  invocationResultConfidence: ValidatorInvocationResultConfidence;
}

export interface ValidatorInvocationResultContractInput {
  validatorInvocationDryRunPlan: ValidatorInvocationDryRunPlan;
  validatorExecutionAdapterContract: ValidatorExecutionAdapterContract;
  validatorPreflightReadinessGate: ValidatorPreflightReadinessGate;
  validatorOperationalReadiness: ValidatorOperationalReadiness;
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

function readiness(input: ValidatorInvocationResultContractInput): ValidatorInvocationResultReadiness {
  if (
    input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'blocked'
    || input.validatorExecutionAdapterContract.overallExecutionAdapterReadiness === 'blocked'
    || input.validatorPreflightReadinessGate.overallPreflightReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'conditional'
    || input.validatorExecutionAdapterContract.overallExecutionAdapterReadiness === 'conditional'
    || input.validatorPreflightReadinessGate.overallPreflightReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(readinessValue: ValidatorInvocationResultReadiness): ValidatorInvocationResultEligibility {
  if (readinessValue === 'blocked') return 'not_recommended';
  if (readinessValue === 'conditional') return 'deferred';
  return 'eligible';
}

function confidence(
  readinessValue: ValidatorInvocationResultReadiness,
  input: ValidatorInvocationResultContractInput,
): ValidatorInvocationResultConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorInvocationDryRunPlan.invocationDryRunConfidence === 'high'
    && input.validatorExecutionAdapterContract.executionAdapterConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorInvocationDryRunPlan.invocationDryRunConfidence === 'low'
    || input.validatorExecutionAdapterContract.executionAdapterConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function adapterFor(input: ValidatorInvocationResultContractInput, sectionIndex: number): SectionExecutionAdapter | undefined {
  return input.validatorExecutionAdapterContract.sectionExecutionAdapters.find((section) => section.sectionIndex === sectionIndex);
}

function traceFor(input: ValidatorInvocationResultContractInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function sectionResult(input: ValidatorInvocationResultContractInput, sectionIndex: number): SectionInvocationResult | null {
  const dryRun = input.validatorInvocationDryRunPlan.sectionInvocationDryRuns.find((section) => section.sectionIndex === sectionIndex);
  const adapter = adapterFor(input, sectionIndex);
  if (!dryRun || !adapter) return null;
  const trace = traceFor(input, sectionIndex);
  const sectionReadiness: ValidatorInvocationResultReadiness = dryRun.invocationReadiness === 'blocked'
    ? 'blocked'
    : dryRun.invocationReadiness === 'conditional'
      ? 'conditional'
      : 'ready';

  return {
    sectionIndex: dryRun.sectionIndex,
    progressionStage: dryRun.progressionStage,
    narrativeRole: dryRun.narrativeRole,
    invocationResultEligibility: eligibility(sectionReadiness),
    resultInputs: unique([
      'section invocation dry-run output',
      'section execution adapter contract',
      ...adapter.adapterInputs,
    ], 10),
    resultOutputs: unique([
      'future validator result status',
      'future validator evidence notes',
      'future validator boundary findings',
      'future validator preservation findings',
      'future validator unresolved risks',
      ...adapter.adapterOutputs,
    ], 12),
    resultDependencies: unique([
      ...dryRun.dependencySimulation,
      ...adapter.adapterDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    resultBoundaries: unique([
      ...dryRun.boundarySimulation,
      ...adapter.adapterBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    resultPreservationRequirements: unique([
      ...dryRun.preservationSimulation,
      ...adapter.adapterPreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    resultVerificationRequirements: unique([
      'future validator result must state pass/fail/needs_review without enforcing',
      'future validator result must preserve advisory-only status',
      ...dryRun.executionSimulation,
    ], 12),
    resultRiskSignals: unique([
      ...dryRun.riskSimulation,
      ...adapter.adapterRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    resultGapSignals: unique([
      ...dryRun.gapSignals,
      ...adapter.adapterGapSignals,
    ], 10),
  };
}

export function buildValidatorInvocationResultContract(
  input: ValidatorInvocationResultContractInput,
): ValidatorInvocationResultContract {
  const overallInvocationResultReadiness = readiness(input);
  const sectionInvocationResults = input.validatorInvocationDryRunPlan.invocationDryRunSequence
    .map((sectionIndex) => sectionResult(input, sectionIndex))
    .filter((section): section is SectionInvocationResult => Boolean(section));

  return {
    version: 'validator-invocation-result-contract-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorInvocationDryRunPlan.contentType,
    topic: input.validatorInvocationDryRunPlan.topic,
    overallInvocationResultReadiness,
    invocationResultEligibility: eligibility(overallInvocationResultReadiness),
    invocationResultInputs: unique([
      'validator invocation dry-run plan',
      'validator execution adapter contract',
      'validator preflight readiness gate',
      'validator operational readiness',
      'validator decision trace',
    ], 10),
    invocationResultOutputs: unique([
      'future validator invocation result package',
      'future validator section result package',
      'future validator verification notes',
      'future validator boundary findings',
      'future validator preservation findings',
      'future validator risk and gap report',
    ], 12),
    invocationResultDependencies: unique([
      ...input.validatorInvocationDryRunPlan.invocationDependencySimulation,
      ...input.validatorExecutionAdapterContract.executionAdapterDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    invocationResultBoundaries: unique([
      ...input.validatorInvocationDryRunPlan.invocationBoundarySimulation,
      ...input.validatorExecutionAdapterContract.executionAdapterBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    invocationResultPreservationRequirements: unique([
      ...input.validatorInvocationDryRunPlan.invocationPreservationSimulation,
      ...input.validatorExecutionAdapterContract.executionAdapterPreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    invocationResultVerificationRequirements: unique([
      'future validator invocation output must be advisory-only until enforcement is separately implemented',
      'future validator invocation output must not mutate content or scores',
      'future validator invocation output must expose boundary and preservation findings',
      ...input.validatorInvocationDryRunPlan.invocationExecutionSimulation,
    ], 18),
    invocationResultRiskSignals: unique([
      ...input.validatorInvocationDryRunPlan.invocationRiskSimulation,
      ...input.validatorExecutionAdapterContract.executionAdapterRiskSignals,
      ...input.validatorOperationalReadiness.operationalGapSignals,
      ...input.validatorDecisionTrace.decisionTraceRiskSignals,
    ], 18),
    invocationResultGapSignals: unique([
      ...input.validatorInvocationDryRunPlan.invocationGapSignals,
      ...input.validatorExecutionAdapterContract.executionAdapterGapSignals,
    ], 18),
    sectionInvocationResults,
    invocationResultConfidence: confidence(overallInvocationResultReadiness, input),
  };
}

export function serializeValidatorInvocationResultContract(contract: ValidatorInvocationResultContract): string {
  return [
    '## VALIDATOR INVOCATION RESULT CONTRACT',
    `Version: ${contract.version}`,
    `Topic: ${contract.topic}`,
    `Content type: ${contract.contentType}`,
    `Invocation result readiness: ${contract.overallInvocationResultReadiness}`,
    `Invocation result eligibility: ${contract.invocationResultEligibility}`,
    `Invocation result confidence: ${contract.invocationResultConfidence}`,
    `Section invocation results: ${contract.sectionInvocationResults.length}`,
    `Gap signals: ${contract.invocationResultGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
