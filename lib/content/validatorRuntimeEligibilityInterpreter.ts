import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type {
  NormalizedValidatorOutputEnvelope,
  SectionNormalizedEnvelope,
} from './normalizedValidatorOutputEnvelope';
import type { ValidatorExecutionEligibilityPolicy } from './validatorExecutionEligibilityPolicy';
import type { ValidatorOutputNormalizationContract } from './validatorOutputNormalizationContract';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorRuntimeEligibilityState = 'runtime_ready' | 'runtime_conditional' | 'runtime_not_ready';
export type ValidatorRuntimeEligibilityConfidence = 'low' | 'medium' | 'high';

export interface SectionRuntimeEligibility {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeEligibilityStatus: ValidatorRuntimeEligibilityState;
  runtimeEligibilityDependencies: readonly string[];
  runtimeEligibilityBoundaries: readonly string[];
  runtimeEligibilityPreservationRequirements: readonly string[];
  runtimeEligibilityVerificationRequirements: readonly string[];
  runtimeEligibilityRiskSignals: readonly string[];
  runtimeEligibilityGapSignals: readonly string[];
}

export interface ValidatorRuntimeEligibilityInterpretation {
  version: 'validator-runtime-eligibility-interpreter-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeEligibility: ValidatorRuntimeEligibilityState;
  runtimeEligibilityStatus: ValidatorRuntimeEligibilityState;
  runtimeEligibilityInputs: readonly string[];
  runtimeEligibilityDependencies: readonly string[];
  runtimeEligibilityBoundaries: readonly string[];
  runtimeEligibilityPreservationRequirements: readonly string[];
  runtimeEligibilityVerificationRequirements: readonly string[];
  runtimeEligibilityRiskSignals: readonly string[];
  runtimeEligibilityGapSignals: readonly string[];
  runtimeEligibilityPolicyInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeEligibilityState[];
    defaultStatus: ValidatorRuntimeEligibilityState;
    advisoryOnly: boolean;
  };
  sectionRuntimeEligibility: readonly SectionRuntimeEligibility[];
  runtimeEligibilityConfidence: ValidatorRuntimeEligibilityConfidence;
}

export interface ValidatorRuntimeEligibilityInterpreterInput {
  validatorExecutionEligibilityPolicy: ValidatorExecutionEligibilityPolicy;
  normalizedValidatorOutputEnvelope: NormalizedValidatorOutputEnvelope;
  validatorOutputNormalizationContract: ValidatorOutputNormalizationContract;
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

function runtimeStatusFromPolicy(
  policyStatus: ValidatorExecutionEligibilityPolicy['executionEligibilityStatus'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeEligibilityState {
  if (policyStatus === 'not_ready' || gapSignals.length > 2) return 'runtime_not_ready';
  if (policyStatus === 'conditional' || riskSignals.length > 0 || gapSignals.length > 0) return 'runtime_conditional';
  return 'runtime_ready';
}

function sectionStatus(section: SectionNormalizedEnvelope): ValidatorRuntimeEligibilityState {
  if (section.envelopeEligibility === 'not_recommended' || section.normalizedStatus === 'not_evaluated') return 'runtime_not_ready';
  if (
    section.envelopeEligibility === 'deferred'
    || section.normalizedStatus === 'needs_review'
    || section.envelopeRiskSignals.length > 0
    || section.envelopeGapSignals.length > 0
  ) return 'runtime_conditional';
  return 'runtime_ready';
}

function confidence(
  status: ValidatorRuntimeEligibilityState,
  input: ValidatorRuntimeEligibilityInterpreterInput,
): ValidatorRuntimeEligibilityConfidence {
  if (
    status === 'runtime_ready'
    && input.validatorExecutionEligibilityPolicy.executionEligibilityConfidence === 'high'
    && input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'high'
  ) return 'high';
  if (
    status === 'runtime_not_ready'
    || input.validatorExecutionEligibilityPolicy.executionEligibilityConfidence === 'low'
    || input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeEligibilityInterpreterInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function buildSectionRuntimeEligibility(
  input: ValidatorRuntimeEligibilityInterpreterInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeEligibility {
  const trace = traceFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeEligibilityStatus: sectionStatus(section),
    runtimeEligibilityDependencies: unique([
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeEligibilityBoundaries: unique([
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeEligibilityPreservationRequirements: unique([
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeEligibilityVerificationRequirements: unique([
      'runtime eligibility interpretation is advisory-only',
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeEligibilityRiskSignals: unique([
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    runtimeEligibilityGapSignals: unique(section.envelopeGapSignals, 10),
  };
}

export function interpretValidatorRuntimeEligibility(
  input: ValidatorRuntimeEligibilityInterpreterInput,
): ValidatorRuntimeEligibilityInterpretation {
  const sectionRuntimeEligibility = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return buildSectionRuntimeEligibility(input, section);
  });
  const runtimeEligibilityRiskSignals = unique([
    ...input.validatorExecutionEligibilityPolicy.executionEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeEligibilityGapSignals = unique([
    ...input.validatorExecutionEligibilityPolicy.executionEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
    ...input.validatorOutputNormalizationContract.normalizationGapSignals,
  ], 18);
  const runtimeEligibilityStatus = runtimeStatusFromPolicy(
    input.validatorExecutionEligibilityPolicy.executionEligibilityStatus,
    runtimeEligibilityRiskSignals,
    runtimeEligibilityGapSignals,
  );

  return {
    version: 'validator-runtime-eligibility-interpreter-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorExecutionEligibilityPolicy.contentType,
    topic: input.validatorExecutionEligibilityPolicy.topic,
    overallRuntimeEligibility: runtimeEligibilityStatus,
    runtimeEligibilityStatus,
    runtimeEligibilityInputs: unique([
      'validator execution eligibility policy',
      'normalized validator output envelope',
      'validator output normalization contract',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    runtimeEligibilityDependencies: unique([
      ...input.validatorExecutionEligibilityPolicy.executionEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    runtimeEligibilityBoundaries: unique([
      ...input.validatorExecutionEligibilityPolicy.executionEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    runtimeEligibilityPreservationRequirements: unique([
      ...input.validatorExecutionEligibilityPolicy.executionEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    runtimeEligibilityVerificationRequirements: unique([
      'runtime eligibility is advisory-only and must not gate runtime behavior',
      'runtime eligibility must not mutate scores, content, regeneration, or validator execution',
      ...input.validatorExecutionEligibilityPolicy.executionEligibilityVerificationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeVerificationRequirements,
    ], 18),
    runtimeEligibilityRiskSignals,
    runtimeEligibilityGapSignals,
    runtimeEligibilityPolicyInterpretation: {
      allowedStatuses: ['runtime_ready', 'runtime_conditional', 'runtime_not_ready'],
      defaultStatus: 'runtime_not_ready',
      advisoryOnly: true,
    },
    sectionRuntimeEligibility,
    runtimeEligibilityConfidence: confidence(runtimeEligibilityStatus, input),
  };
}

export function serializeValidatorRuntimeEligibilityInterpretation(report: ValidatorRuntimeEligibilityInterpretation): string {
  return [
    '## VALIDATOR RUNTIME ELIGIBILITY',
    `Version: ${report.version}`,
    `Topic: ${report.topic}`,
    `Content type: ${report.contentType}`,
    `Runtime eligibility: ${report.overallRuntimeEligibility}`,
    `Runtime confidence: ${report.runtimeEligibilityConfidence}`,
    `Allowed statuses: ${report.runtimeEligibilityPolicyInterpretation.allowedStatuses.join(', ')}`,
    `Section runtime eligibility entries: ${report.sectionRuntimeEligibility.length}`,
    `Gap signals: ${report.runtimeEligibilityGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
