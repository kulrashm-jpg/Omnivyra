import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionPreparation, SectionExecutionPreparation } from './validatorExecutionPreparation';
import type { ValidatorHandoffManifest } from './validatorHandoffManifest';
import type { ValidatorOperationalReadiness } from './validatorOperationalReadiness';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorExecutionAdapterReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorExecutionAdapterEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorExecutionAdapterConfidence = 'low' | 'medium' | 'high';

export interface SectionExecutionAdapter {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executionAdapterEligibility: ValidatorExecutionAdapterEligibility;
  adapterInputs: readonly string[];
  adapterOutputs: readonly string[];
  adapterDependencies: readonly string[];
  adapterBoundaries: readonly string[];
  adapterPreservationRequirements: readonly string[];
  adapterExecutionRequirements: readonly string[];
  adapterRiskSignals: readonly string[];
  adapterGapSignals: readonly string[];
}

export interface ValidatorExecutionAdapterContract {
  version: 'validator-execution-adapter-contract-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallExecutionAdapterReadiness: ValidatorExecutionAdapterReadiness;
  executionAdapterEligibility: ValidatorExecutionAdapterEligibility;
  executionAdapterInputs: readonly string[];
  executionAdapterOutputs: readonly string[];
  executionAdapterDependencies: readonly string[];
  executionAdapterBoundaries: readonly string[];
  executionAdapterPreservationRequirements: readonly string[];
  executionAdapterExecutionRequirements: readonly string[];
  executionAdapterRiskSignals: readonly string[];
  executionAdapterGapSignals: readonly string[];
  sectionExecutionAdapters: readonly SectionExecutionAdapter[];
  executionAdapterConfidence: ValidatorExecutionAdapterConfidence;
}

export interface ValidatorExecutionAdapterContractInput {
  validatorPreflightReadinessGate: ValidatorPreflightReadinessGate;
  validatorOperationalReadiness: ValidatorOperationalReadiness;
  validatorExecutionPreparation: ValidatorExecutionPreparation;
  validatorHandoffManifest: ValidatorHandoffManifest;
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

function readiness(input: ValidatorExecutionAdapterContractInput): ValidatorExecutionAdapterReadiness {
  if (
    input.validatorPreflightReadinessGate.overallPreflightReadiness === 'blocked'
    || input.validatorOperationalReadiness.overallOperationalReadiness === 'blocked'
    || input.validatorExecutionPreparation.overallExecutionPreparationReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorPreflightReadinessGate.overallPreflightReadiness === 'conditional'
    || input.validatorOperationalReadiness.overallOperationalReadiness === 'conditional'
    || input.validatorExecutionPreparation.overallExecutionPreparationReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(readinessValue: ValidatorExecutionAdapterReadiness): ValidatorExecutionAdapterEligibility {
  if (readinessValue === 'blocked') return 'not_recommended';
  if (readinessValue === 'conditional') return 'deferred';
  return 'eligible';
}

function confidence(
  readinessValue: ValidatorExecutionAdapterReadiness,
  input: ValidatorExecutionAdapterContractInput,
): ValidatorExecutionAdapterConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
    && input.validatorOperationalReadiness.operationalReadinessConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
    || input.validatorOperationalReadiness.operationalReadinessConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionPreflightFor(input: ValidatorExecutionAdapterContractInput, sectionIndex: number) {
  return input.validatorPreflightReadinessGate.sectionPreflightReadiness.find((section) => section.sectionIndex === sectionIndex);
}

function sectionTraceFor(input: ValidatorExecutionAdapterContractInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function sectionAdapter(
  input: ValidatorExecutionAdapterContractInput,
  section: SectionExecutionPreparation,
): SectionExecutionAdapter {
  const preflight = sectionPreflightFor(input, section.sectionIndex);
  const trace = sectionTraceFor(input, section.sectionIndex);
  const readinessValue = preflight?.preflightReadiness || input.validatorPreflightReadinessGate.overallPreflightReadiness;

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    executionAdapterEligibility: preflight?.preflightEligibility || eligibility(readinessValue),
    adapterInputs: unique([
      'section execution preparation',
      'section preflight readiness',
      'section decision trace',
      ...section.executionPreparationSignals,
    ], 10),
    adapterOutputs: unique([
      'future validator advisory result',
      'future validator boundary report',
      'future validator preservation report',
      'future validator unresolved risk report',
    ], 10),
    adapterDependencies: unique([
      ...section.dependencies,
      ...(preflight?.dependencyCoverage || []),
      ...(trace?.dependencyTrace || []),
    ], 12),
    adapterBoundaries: unique([
      ...section.boundaries,
      ...(preflight?.boundaryCoverage || []),
      ...(trace?.boundaryTrace || []),
    ], 12),
    adapterPreservationRequirements: unique([
      ...section.preservationSignals,
      ...(preflight?.preservationCoverage || []),
      ...(trace?.preservationTrace || []),
    ], 12),
    adapterExecutionRequirements: unique([
      'validator adapter must remain non-executing until explicit runtime executor is implemented',
      'validator adapter must not mutate content or scores',
      ...section.executionPreparationSignals,
    ], 12),
    adapterRiskSignals: unique([
      ...section.risks,
      ...(trace?.riskTrace || []),
    ], 10),
    adapterGapSignals: unique(preflight?.gapSignals || [], 10),
  };
}

export function buildValidatorExecutionAdapterContract(
  input: ValidatorExecutionAdapterContractInput,
): ValidatorExecutionAdapterContract {
  const overallExecutionAdapterReadiness = readiness(input);
  const sectionExecutionAdapters = input.validatorExecutionPreparation.sectionExecutionPreparation.map((section) => sectionAdapter(input, section));

  return {
    version: 'validator-execution-adapter-contract-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorPreflightReadinessGate.contentType,
    topic: input.validatorPreflightReadinessGate.topic,
    overallExecutionAdapterReadiness,
    executionAdapterEligibility: eligibility(overallExecutionAdapterReadiness),
    executionAdapterInputs: unique([
      'validator preflight readiness gate',
      'validator operational readiness',
      'validator execution preparation',
      'validator handoff manifest',
      'validator decision trace',
    ], 10),
    executionAdapterOutputs: unique([
      'future validator advisory result package',
      'future validator coverage report',
      'future validator boundary report',
      'future validator preservation report',
      'future validator unresolved gap report',
    ], 10),
    executionAdapterDependencies: unique([
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
      ...input.validatorExecutionPreparation.executionPreparationDependencies,
    ], 18),
    executionAdapterBoundaries: unique([
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
      ...input.validatorHandoffManifest.handoffBoundaryRequirements,
    ], 18),
    executionAdapterPreservationRequirements: unique([
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
      ...input.validatorHandoffManifest.handoffPreservationRequirements,
    ], 18),
    executionAdapterExecutionRequirements: unique([
      ...input.validatorPreflightReadinessGate.preflightExecutionCoverage,
      ...input.validatorExecutionPreparation.executionPreparationSignals,
      'adapter output is diagnostic-only until validator execution is separately implemented',
    ], 18),
    executionAdapterRiskSignals: unique([
      ...input.validatorPreflightReadinessGate.preflightRiskSignals,
      ...input.validatorOperationalReadiness.operationalGapSignals,
      ...input.validatorDecisionTrace.decisionTraceRiskSignals,
    ], 18),
    executionAdapterGapSignals: unique(input.validatorPreflightReadinessGate.preflightGapSignals, 18),
    sectionExecutionAdapters,
    executionAdapterConfidence: confidence(overallExecutionAdapterReadiness, input),
  };
}

export function serializeValidatorExecutionAdapterContract(contract: ValidatorExecutionAdapterContract): string {
  return [
    '## VALIDATOR EXECUTION ADAPTER CONTRACT',
    `Version: ${contract.version}`,
    `Topic: ${contract.topic}`,
    `Content type: ${contract.contentType}`,
    `Adapter readiness: ${contract.overallExecutionAdapterReadiness}`,
    `Adapter eligibility: ${contract.executionAdapterEligibility}`,
    `Adapter confidence: ${contract.executionAdapterConfidence}`,
    `Section adapters: ${contract.sectionExecutionAdapters.length}`,
    `Gap signals: ${contract.executionAdapterGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
