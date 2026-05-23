import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorExecutionAdapterContract } from './validatorExecutionAdapterContract';
import type { ValidatorInvocationDryRunPlan } from './validatorInvocationDryRunPlanner';
import type { ValidatorInvocationResultContract } from './validatorInvocationResultContract';
import type {
  SectionNormalizationContract,
  ValidatorOutputNormalizationContract,
} from './validatorOutputNormalizationContract';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type NormalizedEnvelopeReadiness = 'ready' | 'conditional' | 'blocked';
export type NormalizedEnvelopeEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type NormalizedEnvelopeConfidence = 'low' | 'medium' | 'high';
export type NormalizedValidatorStatus = 'pass' | 'fail' | 'needs_review' | 'not_evaluated';

export interface SectionNormalizedEnvelope {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  normalizedStatus: NormalizedValidatorStatus;
  envelopeEligibility: NormalizedEnvelopeEligibility;
  envelopeInputs: readonly string[];
  envelopeOutputs: readonly string[];
  envelopeDependencies: readonly string[];
  envelopeBoundaries: readonly string[];
  envelopePreservationRequirements: readonly string[];
  envelopeVerificationRequirements: readonly string[];
  envelopeRiskSignals: readonly string[];
  envelopeGapSignals: readonly string[];
}

export interface NormalizedValidatorOutputEnvelope {
  version: 'normalized-validator-output-envelope-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallNormalizedEnvelopeReadiness: NormalizedEnvelopeReadiness;
  normalizedEnvelopeEligibility: NormalizedEnvelopeEligibility;
  normalizedEnvelopeInputs: readonly string[];
  normalizedEnvelopeOutputs: readonly string[];
  normalizedEnvelopeDependencies: readonly string[];
  normalizedEnvelopeBoundaries: readonly string[];
  normalizedEnvelopePreservationRequirements: readonly string[];
  normalizedEnvelopeVerificationRequirements: readonly string[];
  normalizedEnvelopeStatusModel: {
    allowedStatuses: readonly NormalizedValidatorStatus[];
    defaultStatus: NormalizedValidatorStatus;
    advisoryOnly: boolean;
  };
  normalizedEnvelopeRiskSignals: readonly string[];
  normalizedEnvelopeGapSignals: readonly string[];
  sectionNormalizedEnvelopes: readonly SectionNormalizedEnvelope[];
  normalizedEnvelopeConfidence: NormalizedEnvelopeConfidence;
}

export interface NormalizedValidatorOutputEnvelopeInput {
  validatorOutputNormalizationContract: ValidatorOutputNormalizationContract;
  validatorInvocationResultContract: ValidatorInvocationResultContract;
  validatorInvocationDryRunPlan: ValidatorInvocationDryRunPlan;
  validatorExecutionAdapterContract: ValidatorExecutionAdapterContract;
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

function readiness(input: NormalizedValidatorOutputEnvelopeInput): NormalizedEnvelopeReadiness {
  if (
    input.validatorOutputNormalizationContract.overallNormalizationReadiness === 'blocked'
    || input.validatorInvocationResultContract.overallInvocationResultReadiness === 'blocked'
    || input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorOutputNormalizationContract.overallNormalizationReadiness === 'conditional'
    || input.validatorInvocationResultContract.overallInvocationResultReadiness === 'conditional'
    || input.validatorInvocationDryRunPlan.overallInvocationDryRunReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(readinessValue: NormalizedEnvelopeReadiness): NormalizedEnvelopeEligibility {
  if (readinessValue === 'blocked') return 'not_recommended';
  if (readinessValue === 'conditional') return 'deferred';
  return 'eligible';
}

function statusFor(eligibilityValue: NormalizedEnvelopeEligibility, riskSignals: readonly string[], gapSignals: readonly string[]): NormalizedValidatorStatus {
  if (eligibilityValue === 'not_recommended') return 'not_evaluated';
  if (gapSignals.length > 0 || riskSignals.length > 0 || eligibilityValue === 'deferred') return 'needs_review';
  return 'pass';
}

function confidence(
  readinessValue: NormalizedEnvelopeReadiness,
  input: NormalizedValidatorOutputEnvelopeInput,
): NormalizedEnvelopeConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorOutputNormalizationContract.normalizationConfidence === 'high'
    && input.validatorInvocationResultContract.invocationResultConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorOutputNormalizationContract.normalizationConfidence === 'low'
    || input.validatorInvocationResultContract.invocationResultConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: NormalizedValidatorOutputEnvelopeInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function sectionEnvelope(
  input: NormalizedValidatorOutputEnvelopeInput,
  section: SectionNormalizationContract,
): SectionNormalizedEnvelope {
  const trace = traceFor(input, section.sectionIndex);
  const sectionReadiness: NormalizedEnvelopeReadiness = section.normalizationEligibility === 'not_recommended'
    ? 'blocked'
    : section.normalizationEligibility === 'deferred'
      ? 'conditional'
      : 'ready';
  const envelopeEligibility = eligibility(sectionReadiness);
  const envelopeRiskSignals = unique([
    ...section.normalizationRiskSignals,
    ...(trace?.riskTrace || []),
  ], 10);
  const envelopeGapSignals = unique(section.normalizationGapSignals, 10);

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    normalizedStatus: statusFor(envelopeEligibility, envelopeRiskSignals, envelopeGapSignals),
    envelopeEligibility,
    envelopeInputs: unique([
      'section normalization contract',
      'section invocation result',
      'section decision trace',
      ...section.normalizationInputs,
    ], 12),
    envelopeOutputs: unique([
      'section normalized status',
      'section normalized findings',
      'section normalized boundary findings',
      'section normalized preservation findings',
      'section normalized risk and gap report',
      ...section.normalizationOutputs,
    ], 14),
    envelopeDependencies: unique([
      ...section.normalizationDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    envelopeBoundaries: unique([
      ...section.normalizationBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    envelopePreservationRequirements: unique([
      ...section.normalizationPreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    envelopeVerificationRequirements: unique([
      'normalized envelope must remain advisory-only',
      ...section.normalizationVerificationRequirements,
    ], 14),
    envelopeRiskSignals,
    envelopeGapSignals,
  };
}

export function buildNormalizedValidatorOutputEnvelope(
  input: NormalizedValidatorOutputEnvelopeInput,
): NormalizedValidatorOutputEnvelope {
  const overallNormalizedEnvelopeReadiness = readiness(input);
  const sectionNormalizedEnvelopes = input.validatorOutputNormalizationContract.sectionNormalizationContracts.map((section) => sectionEnvelope(input, section));
  const normalizedEnvelopeRiskSignals = unique([
    ...input.validatorOutputNormalizationContract.normalizationRiskSignals,
    ...input.validatorInvocationResultContract.invocationResultRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const normalizedEnvelopeGapSignals = unique([
    ...input.validatorOutputNormalizationContract.normalizationGapSignals,
    ...input.validatorInvocationResultContract.invocationResultGapSignals,
    ...input.validatorInvocationDryRunPlan.invocationGapSignals,
  ], 18);

  return {
    version: 'normalized-validator-output-envelope-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorOutputNormalizationContract.contentType,
    topic: input.validatorOutputNormalizationContract.topic,
    overallNormalizedEnvelopeReadiness,
    normalizedEnvelopeEligibility: eligibility(overallNormalizedEnvelopeReadiness),
    normalizedEnvelopeInputs: unique([
      'validator output normalization contract',
      'validator invocation result contract',
      'validator invocation dry-run plan',
      'validator execution adapter contract',
      'validator decision trace',
    ], 10),
    normalizedEnvelopeOutputs: unique([
      'normalized validator output envelope',
      'normalized validator status model',
      'normalized validator section envelopes',
      'normalized validator risk and gap report',
    ], 12),
    normalizedEnvelopeDependencies: unique([
      ...input.validatorOutputNormalizationContract.normalizationDependencies,
      ...input.validatorInvocationResultContract.invocationResultDependencies,
      ...input.validatorInvocationDryRunPlan.invocationDependencySimulation,
    ], 18),
    normalizedEnvelopeBoundaries: unique([
      ...input.validatorOutputNormalizationContract.normalizationBoundaries,
      ...input.validatorInvocationResultContract.invocationResultBoundaries,
      ...input.validatorExecutionAdapterContract.executionAdapterBoundaries,
    ], 18),
    normalizedEnvelopePreservationRequirements: unique([
      ...input.validatorOutputNormalizationContract.normalizationPreservationRequirements,
      ...input.validatorInvocationResultContract.invocationResultPreservationRequirements,
      ...input.validatorExecutionAdapterContract.executionAdapterPreservationRequirements,
    ], 18),
    normalizedEnvelopeVerificationRequirements: unique([
      'normalized envelope status is advisory-only',
      'normalized envelope must not mutate scores or content',
      ...input.validatorOutputNormalizationContract.normalizationVerificationRequirements,
    ], 18),
    normalizedEnvelopeStatusModel: {
      allowedStatuses: ['pass', 'fail', 'needs_review', 'not_evaluated'],
      defaultStatus: 'not_evaluated',
      advisoryOnly: true,
    },
    normalizedEnvelopeRiskSignals,
    normalizedEnvelopeGapSignals,
    sectionNormalizedEnvelopes,
    normalizedEnvelopeConfidence: confidence(overallNormalizedEnvelopeReadiness, input),
  };
}

export function serializeNormalizedValidatorOutputEnvelope(envelope: NormalizedValidatorOutputEnvelope): string {
  return [
    '## NORMALIZED VALIDATOR OUTPUT ENVELOPE',
    `Version: ${envelope.version}`,
    `Topic: ${envelope.topic}`,
    `Content type: ${envelope.contentType}`,
    `Envelope readiness: ${envelope.overallNormalizedEnvelopeReadiness}`,
    `Envelope eligibility: ${envelope.normalizedEnvelopeEligibility}`,
    `Envelope confidence: ${envelope.normalizedEnvelopeConfidence}`,
    `Allowed statuses: ${envelope.normalizedEnvelopeStatusModel.allowedStatuses.join(', ')}`,
    `Section envelopes: ${envelope.sectionNormalizedEnvelopes.length}`,
  ].join('\n');
}
