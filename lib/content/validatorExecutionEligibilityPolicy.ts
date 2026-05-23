import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorInvocationResultContract } from './validatorInvocationResultContract';
import type { ValidatorOutputNormalizationContract } from './validatorOutputNormalizationContract';
import type {
  NormalizedValidatorOutputEnvelope,
  SectionNormalizedEnvelope,
} from './normalizedValidatorOutputEnvelope';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorExecutionEligibilityState = 'ready' | 'conditional' | 'not_ready';
export type ValidatorExecutionEligibilityConfidence = 'low' | 'medium' | 'high';

export interface SectionExecutionEligibility {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  executionEligibilityStatus: ValidatorExecutionEligibilityState;
  eligibilityDependencies: readonly string[];
  eligibilityBoundaries: readonly string[];
  eligibilityPreservationRequirements: readonly string[];
  eligibilityVerificationRequirements: readonly string[];
  eligibilityRiskSignals: readonly string[];
  eligibilityGapSignals: readonly string[];
}

export interface ValidatorExecutionEligibilityPolicy {
  version: 'validator-execution-eligibility-policy-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallExecutionEligibility: ValidatorExecutionEligibilityState;
  executionEligibilityStatus: ValidatorExecutionEligibilityState;
  executionEligibilityInputs: readonly string[];
  executionEligibilityDependencies: readonly string[];
  executionEligibilityBoundaries: readonly string[];
  executionEligibilityPreservationRequirements: readonly string[];
  executionEligibilityVerificationRequirements: readonly string[];
  executionEligibilityRiskSignals: readonly string[];
  executionEligibilityGapSignals: readonly string[];
  executionEligibilityPolicyModel: {
    allowedStatuses: readonly ValidatorExecutionEligibilityState[];
    defaultStatus: ValidatorExecutionEligibilityState;
    advisoryOnly: boolean;
  };
  sectionExecutionEligibility: readonly SectionExecutionEligibility[];
  executionEligibilityConfidence: ValidatorExecutionEligibilityConfidence;
}

export interface ValidatorExecutionEligibilityPolicyInput {
  normalizedValidatorOutputEnvelope: NormalizedValidatorOutputEnvelope;
  validatorOutputNormalizationContract: ValidatorOutputNormalizationContract;
  validatorInvocationResultContract: ValidatorInvocationResultContract;
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

function statusFromReadiness(
  readiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorExecutionEligibilityState {
  if (readiness === 'blocked' || gapSignals.length > 2) return 'not_ready';
  if (readiness === 'conditional' || riskSignals.length > 0 || gapSignals.length > 0) return 'conditional';
  return 'ready';
}

function sectionStatus(section: SectionNormalizedEnvelope): ValidatorExecutionEligibilityState {
  if (section.envelopeEligibility === 'not_recommended' || section.normalizedStatus === 'not_evaluated') return 'not_ready';
  if (
    section.envelopeEligibility === 'deferred'
    || section.normalizedStatus === 'needs_review'
    || section.envelopeRiskSignals.length > 0
    || section.envelopeGapSignals.length > 0
  ) return 'conditional';
  return 'ready';
}

function confidence(
  status: ValidatorExecutionEligibilityState,
  input: ValidatorExecutionEligibilityPolicyInput,
): ValidatorExecutionEligibilityConfidence {
  if (
    status === 'ready'
    && input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'high'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
  ) return 'high';
  if (
    status === 'not_ready'
    || input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'low'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorExecutionEligibilityPolicyInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function sectionEligibility(
  input: ValidatorExecutionEligibilityPolicyInput,
  section: SectionNormalizedEnvelope,
): SectionExecutionEligibility {
  const trace = traceFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    executionEligibilityStatus: sectionStatus(section),
    eligibilityDependencies: unique([
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    eligibilityBoundaries: unique([
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    eligibilityPreservationRequirements: unique([
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    eligibilityVerificationRequirements: unique([
      'eligibility policy is advisory-only',
      ...section.envelopeVerificationRequirements,
    ], 14),
    eligibilityRiskSignals: unique([
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    eligibilityGapSignals: unique(section.envelopeGapSignals, 10),
  };
}

export function buildValidatorExecutionEligibilityPolicy(
  input: ValidatorExecutionEligibilityPolicyInput,
): ValidatorExecutionEligibilityPolicy {
  const sectionExecutionEligibility = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return sectionEligibility(input, section);
  });
  const executionEligibilityRiskSignals = unique([
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorOutputNormalizationContract.normalizationRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const executionEligibilityGapSignals = unique([
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
    ...input.validatorOutputNormalizationContract.normalizationGapSignals,
    ...input.validatorInvocationResultContract.invocationResultGapSignals,
  ], 18);
  const executionEligibilityStatus = statusFromReadiness(
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    executionEligibilityRiskSignals,
    executionEligibilityGapSignals,
  );

  return {
    version: 'validator-execution-eligibility-policy-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.normalizedValidatorOutputEnvelope.contentType,
    topic: input.normalizedValidatorOutputEnvelope.topic,
    overallExecutionEligibility: executionEligibilityStatus,
    executionEligibilityStatus,
    executionEligibilityInputs: unique([
      'normalized validator output envelope',
      'validator output normalization contract',
      'validator invocation result contract',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    executionEligibilityDependencies: unique([
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
      ...input.validatorOutputNormalizationContract.normalizationDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    executionEligibilityBoundaries: unique([
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
      ...input.validatorOutputNormalizationContract.normalizationBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    executionEligibilityPreservationRequirements: unique([
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
      ...input.validatorOutputNormalizationContract.normalizationPreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    executionEligibilityVerificationRequirements: unique([
      'execution eligibility is advisory-only and must not gate runtime behavior',
      'execution eligibility must not mutate scores, content, or regeneration state',
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeVerificationRequirements,
      ...input.validatorOutputNormalizationContract.normalizationVerificationRequirements,
    ], 18),
    executionEligibilityRiskSignals,
    executionEligibilityGapSignals,
    executionEligibilityPolicyModel: {
      allowedStatuses: ['ready', 'conditional', 'not_ready'],
      defaultStatus: 'not_ready',
      advisoryOnly: true,
    },
    sectionExecutionEligibility,
    executionEligibilityConfidence: confidence(executionEligibilityStatus, input),
  };
}

export function serializeValidatorExecutionEligibilityPolicy(policy: ValidatorExecutionEligibilityPolicy): string {
  return [
    '## VALIDATOR EXECUTION ELIGIBILITY POLICY',
    `Version: ${policy.version}`,
    `Topic: ${policy.topic}`,
    `Content type: ${policy.contentType}`,
    `Execution eligibility: ${policy.overallExecutionEligibility}`,
    `Eligibility confidence: ${policy.executionEligibilityConfidence}`,
    `Allowed statuses: ${policy.executionEligibilityPolicyModel.allowedStatuses.join(', ')}`,
    `Section eligibility entries: ${policy.sectionExecutionEligibility.length}`,
    `Gap signals: ${policy.executionEligibilityGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
