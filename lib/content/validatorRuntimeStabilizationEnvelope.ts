import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type {
  NormalizedValidatorOutputEnvelope,
  SectionNormalizedEnvelope,
} from './normalizedValidatorOutputEnvelope';
import type {
  SectionRuntimeEligibility,
  ValidatorRuntimeEligibilityInterpretation,
} from './validatorRuntimeEligibilityInterpreter';
import type {
  SectionRuntimeReadiness,
  ValidatorRuntimeReadinessEnvelope,
} from './validatorRuntimeReadinessEnvelope';
import type {
  SectionRuntimeGovernance,
  ValidatorRuntimeGovernanceEnvelope,
} from './validatorRuntimeGovernanceEnvelope';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorRuntimeStabilizationState =
  | 'stabilization_ready'
  | 'stabilization_conditional'
  | 'stabilization_not_ready';
export type ValidatorRuntimeStabilizationConfidence = 'low' | 'medium' | 'high';

export interface SectionRuntimeStabilization {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeStabilizationStatus: ValidatorRuntimeStabilizationState;
  runtimeStabilizationDependencies: readonly string[];
  runtimeStabilizationBoundaries: readonly string[];
  runtimeStabilizationPreservationRequirements: readonly string[];
  runtimeStabilizationVerificationRequirements: readonly string[];
  runtimeStabilizationRiskSignals: readonly string[];
  runtimeStabilizationGapSignals: readonly string[];
}

export interface ValidatorRuntimeStabilizationEnvelope {
  version: 'validator-runtime-stabilization-envelope-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeStabilizationReadiness: ValidatorRuntimeStabilizationState;
  runtimeStabilizationStatus: ValidatorRuntimeStabilizationState;
  runtimeStabilizationInputs: readonly string[];
  runtimeStabilizationDependencies: readonly string[];
  runtimeStabilizationBoundaries: readonly string[];
  runtimeStabilizationPreservationRequirements: readonly string[];
  runtimeStabilizationVerificationRequirements: readonly string[];
  runtimeStabilizationRiskSignals: readonly string[];
  runtimeStabilizationGapSignals: readonly string[];
  runtimeStabilizationInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeStabilizationState[];
    defaultStatus: ValidatorRuntimeStabilizationState;
    advisoryOnly: boolean;
  };
  sectionRuntimeStabilization: readonly SectionRuntimeStabilization[];
  runtimeStabilizationConfidence: ValidatorRuntimeStabilizationConfidence;
}

export interface ValidatorRuntimeStabilizationEnvelopeInput {
  validatorRuntimeGovernanceEnvelope: ValidatorRuntimeGovernanceEnvelope;
  validatorRuntimeReadinessEnvelope: ValidatorRuntimeReadinessEnvelope;
  validatorRuntimeEligibilityInterpretation: ValidatorRuntimeEligibilityInterpretation;
  normalizedValidatorOutputEnvelope: NormalizedValidatorOutputEnvelope;
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

function stabilizationStatus(
  governanceStatus: ValidatorRuntimeGovernanceEnvelope['runtimeGovernanceStatus'],
  readinessStatus: ValidatorRuntimeReadinessEnvelope['runtimeReadinessStatus'],
  eligibilityStatus: ValidatorRuntimeEligibilityInterpretation['runtimeEligibilityStatus'],
  envelopeReadiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeStabilizationState {
  if (
    governanceStatus === 'governance_not_ready'
    || readinessStatus === 'runtime_not_ready'
    || eligibilityStatus === 'runtime_not_ready'
    || envelopeReadiness === 'blocked'
    || gapSignals.length > 2
  ) return 'stabilization_not_ready';
  if (
    governanceStatus === 'governance_conditional'
    || readinessStatus === 'runtime_conditional'
    || eligibilityStatus === 'runtime_conditional'
    || envelopeReadiness === 'conditional'
    || riskSignals.length > 0
    || gapSignals.length > 0
  ) return 'stabilization_conditional';
  return 'stabilization_ready';
}

function sectionStatus(
  governance: SectionRuntimeGovernance | undefined,
  readiness: SectionRuntimeReadiness | undefined,
  eligibility: SectionRuntimeEligibility | undefined,
  envelope: SectionNormalizedEnvelope,
): ValidatorRuntimeStabilizationState {
  if (
    governance?.runtimeGovernanceStatus === 'governance_not_ready'
    || readiness?.runtimeReadinessStatus === 'runtime_not_ready'
    || eligibility?.runtimeEligibilityStatus === 'runtime_not_ready'
    || envelope.envelopeEligibility === 'not_recommended'
    || envelope.normalizedStatus === 'not_evaluated'
  ) return 'stabilization_not_ready';
  if (
    governance?.runtimeGovernanceStatus === 'governance_conditional'
    || readiness?.runtimeReadinessStatus === 'runtime_conditional'
    || eligibility?.runtimeEligibilityStatus === 'runtime_conditional'
    || envelope.envelopeEligibility === 'deferred'
    || envelope.normalizedStatus === 'needs_review'
    || envelope.envelopeRiskSignals.length > 0
    || envelope.envelopeGapSignals.length > 0
  ) return 'stabilization_conditional';
  return 'stabilization_ready';
}

function confidence(
  status: ValidatorRuntimeStabilizationState,
  input: ValidatorRuntimeStabilizationEnvelopeInput,
): ValidatorRuntimeStabilizationConfidence {
  if (
    status === 'stabilization_ready'
    && input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'high'
    && input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'high'
    && input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'high'
    && input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'high'
  ) return 'high';
  if (
    status === 'stabilization_not_ready'
    || input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'low'
    || input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'low'
    || input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'low'
    || input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeStabilizationEnvelopeInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function governanceFor(input: ValidatorRuntimeStabilizationEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeGovernanceEnvelope.sectionRuntimeGovernance.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function readinessFor(input: ValidatorRuntimeStabilizationEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeReadinessEnvelope.sectionRuntimeReadiness.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function eligibilityFor(input: ValidatorRuntimeStabilizationEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeEligibilityInterpretation.sectionRuntimeEligibility.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function buildSectionRuntimeStabilization(
  input: ValidatorRuntimeStabilizationEnvelopeInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeStabilization {
  const trace = traceFor(input, section.sectionIndex);
  const governance = governanceFor(input, section.sectionIndex);
  const readiness = readinessFor(input, section.sectionIndex);
  const eligibility = eligibilityFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeStabilizationStatus: sectionStatus(governance, readiness, eligibility, section),
    runtimeStabilizationDependencies: unique([
      ...(governance?.runtimeGovernanceDependencies || []),
      ...(readiness?.runtimeReadinessDependencies || []),
      ...(eligibility?.runtimeEligibilityDependencies || []),
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeStabilizationBoundaries: unique([
      ...(governance?.runtimeGovernanceBoundaries || []),
      ...(readiness?.runtimeReadinessBoundaries || []),
      ...(eligibility?.runtimeEligibilityBoundaries || []),
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeStabilizationPreservationRequirements: unique([
      ...(governance?.runtimeGovernancePreservationRequirements || []),
      ...(readiness?.runtimeReadinessPreservationRequirements || []),
      ...(eligibility?.runtimeEligibilityPreservationRequirements || []),
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeStabilizationVerificationRequirements: unique([
      'runtime stabilization envelope is advisory-only',
      ...(governance?.runtimeGovernanceVerificationRequirements || []),
      ...(readiness?.runtimeReadinessVerificationRequirements || []),
      ...(eligibility?.runtimeEligibilityVerificationRequirements || []),
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeStabilizationRiskSignals: unique([
      ...(governance?.runtimeGovernanceRiskSignals || []),
      ...(readiness?.runtimeReadinessRiskSignals || []),
      ...(eligibility?.runtimeEligibilityRiskSignals || []),
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    runtimeStabilizationGapSignals: unique([
      ...(governance?.runtimeGovernanceGapSignals || []),
      ...(readiness?.runtimeReadinessGapSignals || []),
      ...(eligibility?.runtimeEligibilityGapSignals || []),
      ...section.envelopeGapSignals,
    ], 10),
  };
}

export function buildValidatorRuntimeStabilizationEnvelope(
  input: ValidatorRuntimeStabilizationEnvelopeInput,
): ValidatorRuntimeStabilizationEnvelope {
  const sectionRuntimeStabilization = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return buildSectionRuntimeStabilization(input, section);
  });
  const runtimeStabilizationRiskSignals = unique([
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceRiskSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessRiskSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeStabilizationGapSignals = unique([
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceGapSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessGapSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
  ], 18);
  const runtimeStabilizationStatus = stabilizationStatus(
    input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceStatus,
    input.validatorRuntimeReadinessEnvelope.runtimeReadinessStatus,
    input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityStatus,
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    runtimeStabilizationRiskSignals,
    runtimeStabilizationGapSignals,
  );

  return {
    version: 'validator-runtime-stabilization-envelope-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRuntimeGovernanceEnvelope.contentType,
    topic: input.validatorRuntimeGovernanceEnvelope.topic,
    overallRuntimeStabilizationReadiness: runtimeStabilizationStatus,
    runtimeStabilizationStatus,
    runtimeStabilizationInputs: unique([
      'validator runtime governance envelope',
      'validator runtime readiness envelope',
      'validator runtime eligibility interpretation',
      'normalized validator output envelope',
      'validator decision trace',
    ], 10),
    runtimeStabilizationDependencies: unique([
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceDependencies,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessDependencies,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
    ], 18),
    runtimeStabilizationBoundaries: unique([
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceBoundaries,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessBoundaries,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
    ], 18),
    runtimeStabilizationPreservationRequirements: unique([
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernancePreservationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessPreservationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
    ], 18),
    runtimeStabilizationVerificationRequirements: unique([
      'runtime stabilization envelope is advisory-only and must not gate runtime behavior',
      'runtime stabilization envelope must not execute validators, mutate scores, regenerate content, or enforce outcomes',
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceVerificationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessVerificationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityVerificationRequirements,
    ], 18),
    runtimeStabilizationRiskSignals,
    runtimeStabilizationGapSignals,
    runtimeStabilizationInterpretation: {
      allowedStatuses: ['stabilization_ready', 'stabilization_conditional', 'stabilization_not_ready'],
      defaultStatus: 'stabilization_not_ready',
      advisoryOnly: true,
    },
    sectionRuntimeStabilization,
    runtimeStabilizationConfidence: confidence(runtimeStabilizationStatus, input),
  };
}

export function serializeValidatorRuntimeStabilizationEnvelope(
  envelope: ValidatorRuntimeStabilizationEnvelope,
): string {
  return [
    '## VALIDATOR RUNTIME STABILIZATION ENVELOPE',
    `Version: ${envelope.version}`,
    `Topic: ${envelope.topic}`,
    `Content type: ${envelope.contentType}`,
    `Runtime stabilization: ${envelope.overallRuntimeStabilizationReadiness}`,
    `Runtime stabilization confidence: ${envelope.runtimeStabilizationConfidence}`,
    `Allowed statuses: ${envelope.runtimeStabilizationInterpretation.allowedStatuses.join(', ')}`,
    `Section runtime stabilization entries: ${envelope.sectionRuntimeStabilization.length}`,
    `Gap signals: ${envelope.runtimeStabilizationGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
