import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionAdapterContract } from './validatorExecutionAdapterContract';
import type { ValidatorInvocationDryRunPlan } from './validatorInvocationDryRunPlanner';
import type {
  SectionInvocationResult,
  ValidatorInvocationResultContract,
} from './validatorInvocationResultContract';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorOutputNormalizationReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorOutputNormalizationEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorOutputNormalizationConfidence = 'low' | 'medium' | 'high';

export interface SectionNormalizationContract {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  normalizationEligibility: ValidatorOutputNormalizationEligibility;
  normalizationInputs: readonly string[];
  normalizationOutputs: readonly string[];
  normalizationDependencies: readonly string[];
  normalizationBoundaries: readonly string[];
  normalizationPreservationRequirements: readonly string[];
  normalizationVerificationRequirements: readonly string[];
  normalizationRiskSignals: readonly string[];
  normalizationGapSignals: readonly string[];
}

export interface ValidatorOutputNormalizationContract {
  version: 'validator-output-normalization-contract-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallNormalizationReadiness: ValidatorOutputNormalizationReadiness;
  normalizationEligibility: ValidatorOutputNormalizationEligibility;
  normalizationInputs: readonly string[];
  normalizationOutputs: readonly string[];
  normalizationDependencies: readonly string[];
  normalizationBoundaries: readonly string[];
  normalizationPreservationRequirements: readonly string[];
  normalizationVerificationRequirements: readonly string[];
  normalizationRiskSignals: readonly string[];
  normalizationGapSignals: readonly string[];
  sectionNormalizationContracts: readonly SectionNormalizationContract[];
  normalizationConfidence: ValidatorOutputNormalizationConfidence;
}

export interface ValidatorOutputNormalizationContractInput {
  validatorInvocationResultContract: ValidatorInvocationResultContract;
  validatorInvocationDryRunPlan: ValidatorInvocationDryRunPlan;
  validatorExecutionAdapterContract: ValidatorExecutionAdapterContract;
  validatorPreflightReadinessGate: ValidatorPreflightReadinessGate;
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

function readiness(input: ValidatorOutputNormalizationContractInput): ValidatorOutputNormalizationReadiness {
  if (
    input.validatorInvocationResultContract.overallInvocationResultReadiness === 'blocked'
    || input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'blocked'
    || input.validatorPreflightReadinessGate.overallPreflightReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorInvocationResultContract.overallInvocationResultReadiness === 'conditional'
    || input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'conditional'
    || input.validatorPreflightReadinessGate.overallPreflightReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(readinessValue: ValidatorOutputNormalizationReadiness): ValidatorOutputNormalizationEligibility {
  if (readinessValue === 'blocked') return 'not_recommended';
  if (readinessValue === 'conditional') return 'deferred';
  return 'eligible';
}

function confidence(
  readinessValue: ValidatorOutputNormalizationReadiness,
  input: ValidatorOutputNormalizationContractInput,
): ValidatorOutputNormalizationConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorInvocationResultContract.invocationResultConfidence === 'high'
    && input.validatorInvocationDryRunPlan.invocationDryRunConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorInvocationResultContract.invocationResultConfidence === 'low'
    || input.validatorInvocationDryRunPlan.invocationDryRunConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorOutputNormalizationContractInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function sectionNormalization(
  input: ValidatorOutputNormalizationContractInput,
  section: SectionInvocationResult,
): SectionNormalizationContract {
  const trace = traceFor(input, section.sectionIndex);
  const sectionReadiness: ValidatorOutputNormalizationReadiness = section.invocationResultEligibility === 'not_recommended'
    ? 'blocked'
    : section.invocationResultEligibility === 'deferred'
      ? 'conditional'
      : 'ready';

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    normalizationEligibility: eligibility(sectionReadiness),
    normalizationInputs: unique([
      'section invocation result contract',
      'section invocation dry-run output',
      'section decision trace',
      ...section.resultInputs,
    ], 12),
    normalizationOutputs: unique([
      'normalized validator section status',
      'normalized validator finding list',
      'normalized validator boundary findings',
      'normalized validator preservation findings',
      'normalized validator unresolved risks',
      ...section.resultOutputs,
    ], 14),
    normalizationDependencies: unique([
      ...section.resultDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    normalizationBoundaries: unique([
      ...section.resultBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    normalizationPreservationRequirements: unique([
      ...section.resultPreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    normalizationVerificationRequirements: unique([
      'normalize validator status into pass, fail, or needs_review',
      'normalize validator output without enforcing the result',
      ...section.resultVerificationRequirements,
    ], 14),
    normalizationRiskSignals: unique([
      ...section.resultRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    normalizationGapSignals: unique(section.resultGapSignals, 10),
  };
}

export function buildValidatorOutputNormalizationContract(
  input: ValidatorOutputNormalizationContractInput,
): ValidatorOutputNormalizationContract {
  const overallNormalizationReadiness = readiness(input);
  const sectionNormalizationContracts = input.validatorInvocationResultContract.sectionInvocationResults.map((section) => sectionNormalization(input, section));

  return {
    version: 'validator-output-normalization-contract-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorInvocationResultContract.contentType,
    topic: input.validatorInvocationResultContract.topic,
    overallNormalizationReadiness,
    normalizationEligibility: eligibility(overallNormalizationReadiness),
    normalizationInputs: unique([
      'validator invocation result contract',
      'validator invocation dry-run plan',
      'validator execution adapter contract',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    normalizationOutputs: unique([
      'normalized validator result package',
      'normalized validator section results',
      'normalized validator status field',
      'normalized validator findings',
      'normalized validator risk and gap report',
    ], 12),
    normalizationDependencies: unique([
      ...input.validatorInvocationResultContract.invocationResultDependencies,
      ...input.validatorInvocationDryRunPlan.invocationDependencySimulation,
      ...input.validatorExecutionAdapterContract.executionAdapterDependencies,
    ], 18),
    normalizationBoundaries: unique([
      ...input.validatorInvocationResultContract.invocationResultBoundaries,
      ...input.validatorInvocationDryRunPlan.invocationBoundarySimulation,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    normalizationPreservationRequirements: unique([
      ...input.validatorInvocationResultContract.invocationResultPreservationRequirements,
      ...input.validatorInvocationDryRunPlan.invocationPreservationSimulation,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    normalizationVerificationRequirements: unique([
      'validator output normalization remains advisory-only',
      'normalization must not mutate scores, content, or runtime state',
      'normalization must preserve boundary and preservation findings',
      ...input.validatorInvocationResultContract.invocationResultVerificationRequirements,
    ], 18),
    normalizationRiskSignals: unique([
      ...input.validatorInvocationResultContract.invocationResultRiskSignals,
      ...input.validatorInvocationDryRunPlan.invocationRiskSimulation,
      ...input.validatorDecisionTrace.decisionTraceRiskSignals,
    ], 18),
    normalizationGapSignals: unique([
      ...input.validatorInvocationResultContract.invocationResultGapSignals,
      ...input.validatorInvocationDryRunPlan.invocationGapSignals,
    ], 18),
    sectionNormalizationContracts,
    normalizationConfidence: confidence(overallNormalizationReadiness, input),
  };
}

export function serializeValidatorOutputNormalizationContract(contract: ValidatorOutputNormalizationContract): string {
  return [
    '## VALIDATOR OUTPUT NORMALIZATION CONTRACT',
    `Version: ${contract.version}`,
    `Topic: ${contract.topic}`,
    `Content type: ${contract.contentType}`,
    `Normalization readiness: ${contract.overallNormalizationReadiness}`,
    `Normalization eligibility: ${contract.normalizationEligibility}`,
    `Normalization confidence: ${contract.normalizationConfidence}`,
    `Section normalization contracts: ${contract.sectionNormalizationContracts.length}`,
    `Gap signals: ${contract.normalizationGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
