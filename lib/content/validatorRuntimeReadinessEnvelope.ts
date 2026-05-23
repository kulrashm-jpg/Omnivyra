import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type {
  NormalizedValidatorOutputEnvelope,
  SectionNormalizedEnvelope,
} from './normalizedValidatorOutputEnvelope';
import type { ValidatorOutputNormalizationContract } from './validatorOutputNormalizationContract';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
import type {
  SectionRuntimeEligibility,
  ValidatorRuntimeEligibilityInterpretation,
} from './validatorRuntimeEligibilityInterpreter';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorRuntimeReadinessState = 'runtime_ready' | 'runtime_conditional' | 'runtime_not_ready';
export type ValidatorRuntimeReadinessConfidence = 'low' | 'medium' | 'high';

export interface SectionRuntimeReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeReadinessStatus: ValidatorRuntimeReadinessState;
  runtimeReadinessDependencies: readonly string[];
  runtimeReadinessBoundaries: readonly string[];
  runtimeReadinessPreservationRequirements: readonly string[];
  runtimeReadinessVerificationRequirements: readonly string[];
  runtimeReadinessRiskSignals: readonly string[];
  runtimeReadinessGapSignals: readonly string[];
}

export interface ValidatorRuntimeReadinessEnvelope {
  version: 'validator-runtime-readiness-envelope-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeReadiness: ValidatorRuntimeReadinessState;
  runtimeReadinessStatus: ValidatorRuntimeReadinessState;
  runtimeReadinessInputs: readonly string[];
  runtimeReadinessDependencies: readonly string[];
  runtimeReadinessBoundaries: readonly string[];
  runtimeReadinessPreservationRequirements: readonly string[];
  runtimeReadinessVerificationRequirements: readonly string[];
  runtimeReadinessRiskSignals: readonly string[];
  runtimeReadinessGapSignals: readonly string[];
  runtimeReadinessInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeReadinessState[];
    defaultStatus: ValidatorRuntimeReadinessState;
    advisoryOnly: boolean;
  };
  sectionRuntimeReadiness: readonly SectionRuntimeReadiness[];
  runtimeReadinessConfidence: ValidatorRuntimeReadinessConfidence;
}

export interface ValidatorRuntimeReadinessEnvelopeInput {
  validatorRuntimeEligibilityInterpretation: ValidatorRuntimeEligibilityInterpretation;
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

function readinessStatus(
  eligibilityStatus: ValidatorRuntimeEligibilityInterpretation['runtimeEligibilityStatus'],
  envelopeReadiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeReadinessState {
  if (eligibilityStatus === 'runtime_not_ready' || envelopeReadiness === 'blocked' || gapSignals.length > 2) return 'runtime_not_ready';
  if (
    eligibilityStatus === 'runtime_conditional'
    || envelopeReadiness === 'conditional'
    || riskSignals.length > 0
    || gapSignals.length > 0
  ) return 'runtime_conditional';
  return 'runtime_ready';
}

function sectionStatus(
  eligibility: SectionRuntimeEligibility | undefined,
  envelope: SectionNormalizedEnvelope,
): ValidatorRuntimeReadinessState {
  if (
    eligibility?.runtimeEligibilityStatus === 'runtime_not_ready'
    || envelope.envelopeEligibility === 'not_recommended'
    || envelope.normalizedStatus === 'not_evaluated'
  ) return 'runtime_not_ready';
  if (
    eligibility?.runtimeEligibilityStatus === 'runtime_conditional'
    || envelope.envelopeEligibility === 'deferred'
    || envelope.normalizedStatus === 'needs_review'
    || envelope.envelopeRiskSignals.length > 0
    || envelope.envelopeGapSignals.length > 0
  ) return 'runtime_conditional';
  return 'runtime_ready';
}

function confidence(
  status: ValidatorRuntimeReadinessState,
  input: ValidatorRuntimeReadinessEnvelopeInput,
): ValidatorRuntimeReadinessConfidence {
  if (
    status === 'runtime_ready'
    && input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'high'
    && input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'high'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
  ) return 'high';
  if (
    status === 'runtime_not_ready'
    || input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'low'
    || input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'low'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeReadinessEnvelopeInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function eligibilityFor(input: ValidatorRuntimeReadinessEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeEligibilityInterpretation.sectionRuntimeEligibility.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function buildSectionRuntimeReadiness(
  input: ValidatorRuntimeReadinessEnvelopeInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeReadiness {
  const trace = traceFor(input, section.sectionIndex);
  const eligibility = eligibilityFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeReadinessStatus: sectionStatus(eligibility, section),
    runtimeReadinessDependencies: unique([
      ...(eligibility?.runtimeEligibilityDependencies || []),
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeReadinessBoundaries: unique([
      ...(eligibility?.runtimeEligibilityBoundaries || []),
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeReadinessPreservationRequirements: unique([
      ...(eligibility?.runtimeEligibilityPreservationRequirements || []),
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeReadinessVerificationRequirements: unique([
      'runtime readiness envelope is advisory-only',
      ...(eligibility?.runtimeEligibilityVerificationRequirements || []),
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeReadinessRiskSignals: unique([
      ...(eligibility?.runtimeEligibilityRiskSignals || []),
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    runtimeReadinessGapSignals: unique([
      ...(eligibility?.runtimeEligibilityGapSignals || []),
      ...section.envelopeGapSignals,
    ], 10),
  };
}

export function buildValidatorRuntimeReadinessEnvelope(
  input: ValidatorRuntimeReadinessEnvelopeInput,
): ValidatorRuntimeReadinessEnvelope {
  const sectionRuntimeReadiness = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return buildSectionRuntimeReadiness(input, section);
  });
  const runtimeReadinessRiskSignals = unique([
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeReadinessGapSignals = unique([
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
    ...input.validatorOutputNormalizationContract.normalizationGapSignals,
    ...input.validatorPreflightReadinessGate.preflightGapSignals,
  ], 18);
  const runtimeReadinessStatus = readinessStatus(
    input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityStatus,
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    runtimeReadinessRiskSignals,
    runtimeReadinessGapSignals,
  );

  return {
    version: 'validator-runtime-readiness-envelope-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRuntimeEligibilityInterpretation.contentType,
    topic: input.validatorRuntimeEligibilityInterpretation.topic,
    overallRuntimeReadiness: runtimeReadinessStatus,
    runtimeReadinessStatus,
    runtimeReadinessInputs: unique([
      'validator runtime eligibility interpretation',
      'normalized validator output envelope',
      'validator output normalization contract',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    runtimeReadinessDependencies: unique([
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    runtimeReadinessBoundaries: unique([
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    runtimeReadinessPreservationRequirements: unique([
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    runtimeReadinessVerificationRequirements: unique([
      'runtime readiness envelope is advisory-only and must not gate runtime behavior',
      'runtime readiness envelope must not execute validators, mutate scores, regenerate content, or enforce outcomes',
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityVerificationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeVerificationRequirements,
      ...input.validatorOutputNormalizationContract.normalizationVerificationRequirements,
    ], 18),
    runtimeReadinessRiskSignals,
    runtimeReadinessGapSignals,
    runtimeReadinessInterpretation: {
      allowedStatuses: ['runtime_ready', 'runtime_conditional', 'runtime_not_ready'],
      defaultStatus: 'runtime_not_ready',
      advisoryOnly: true,
    },
    sectionRuntimeReadiness,
    runtimeReadinessConfidence: confidence(runtimeReadinessStatus, input),
  };
}

export function serializeValidatorRuntimeReadinessEnvelope(envelope: ValidatorRuntimeReadinessEnvelope): string {
  return [
    '## VALIDATOR RUNTIME READINESS ENVELOPE',
    `Version: ${envelope.version}`,
    `Topic: ${envelope.topic}`,
    `Content type: ${envelope.contentType}`,
    `Runtime readiness: ${envelope.overallRuntimeReadiness}`,
    `Runtime readiness confidence: ${envelope.runtimeReadinessConfidence}`,
    `Allowed statuses: ${envelope.runtimeReadinessInterpretation.allowedStatuses.join(', ')}`,
    `Section runtime readiness entries: ${envelope.sectionRuntimeReadiness.length}`,
    `Gap signals: ${envelope.runtimeReadinessGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
