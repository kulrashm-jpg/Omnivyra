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
import type {
  SectionRuntimeStabilization,
  ValidatorRuntimeStabilizationEnvelope,
} from './validatorRuntimeStabilizationEnvelope';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorRuntimeActivationState =
  | 'activation_ready'
  | 'activation_hold'
  | 'activation_withhold';
export type ValidatorRuntimeActivationRecommendation = 'activate' | 'hold' | 'withhold';
export type ValidatorRuntimeActivationConfidence = 'low' | 'medium' | 'high';

export interface SectionRuntimeActivationReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeActivationStatus: ValidatorRuntimeActivationState;
  runtimeActivationRecommendation: ValidatorRuntimeActivationRecommendation;
  runtimeActivationDependencies: readonly string[];
  runtimeActivationBoundaries: readonly string[];
  runtimeActivationPreservationRequirements: readonly string[];
  runtimeActivationVerificationRequirements: readonly string[];
  runtimeActivationRiskSignals: readonly string[];
  runtimeActivationGapSignals: readonly string[];
}

export interface ValidatorRuntimeActivationReadinessGate {
  version: 'validator-runtime-activation-readiness-gate-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeActivationReadiness: ValidatorRuntimeActivationState;
  runtimeActivationStatus: ValidatorRuntimeActivationState;
  runtimeActivationInputs: readonly string[];
  runtimeActivationDependencies: readonly string[];
  runtimeActivationBoundaries: readonly string[];
  runtimeActivationPreservationRequirements: readonly string[];
  runtimeActivationVerificationRequirements: readonly string[];
  runtimeActivationRiskSignals: readonly string[];
  runtimeActivationGapSignals: readonly string[];
  runtimeActivationInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeActivationState[];
    allowedRecommendations: readonly ValidatorRuntimeActivationRecommendation[];
    defaultStatus: ValidatorRuntimeActivationState;
    defaultRecommendation: ValidatorRuntimeActivationRecommendation;
    advisoryOnly: boolean;
  };
  runtimeActivationRecommendation: ValidatorRuntimeActivationRecommendation;
  sectionRuntimeActivationReadiness: readonly SectionRuntimeActivationReadiness[];
  runtimeActivationConfidence: ValidatorRuntimeActivationConfidence;
}

export interface ValidatorRuntimeActivationReadinessGateInput {
  validatorRuntimeStabilizationEnvelope: ValidatorRuntimeStabilizationEnvelope;
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

function activationStatus(
  stabilizationStatus: ValidatorRuntimeStabilizationEnvelope['runtimeStabilizationStatus'],
  governanceStatus: ValidatorRuntimeGovernanceEnvelope['runtimeGovernanceStatus'],
  readinessStatus: ValidatorRuntimeReadinessEnvelope['runtimeReadinessStatus'],
  eligibilityStatus: ValidatorRuntimeEligibilityInterpretation['runtimeEligibilityStatus'],
  envelopeReadiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeActivationState {
  if (
    stabilizationStatus === 'stabilization_not_ready'
    || governanceStatus === 'governance_not_ready'
    || readinessStatus === 'runtime_not_ready'
    || eligibilityStatus === 'runtime_not_ready'
    || envelopeReadiness === 'blocked'
    || gapSignals.length > 2
  ) return 'activation_withhold';
  if (
    stabilizationStatus === 'stabilization_conditional'
    || governanceStatus === 'governance_conditional'
    || readinessStatus === 'runtime_conditional'
    || eligibilityStatus === 'runtime_conditional'
    || envelopeReadiness === 'conditional'
    || riskSignals.length > 0
    || gapSignals.length > 0
  ) return 'activation_hold';
  return 'activation_ready';
}

function recommendationFor(status: ValidatorRuntimeActivationState): ValidatorRuntimeActivationRecommendation {
  if (status === 'activation_ready') return 'activate';
  if (status === 'activation_hold') return 'hold';
  return 'withhold';
}

function sectionStatus(
  stabilization: SectionRuntimeStabilization | undefined,
  governance: SectionRuntimeGovernance | undefined,
  readiness: SectionRuntimeReadiness | undefined,
  eligibility: SectionRuntimeEligibility | undefined,
  envelope: SectionNormalizedEnvelope,
): ValidatorRuntimeActivationState {
  if (
    stabilization?.runtimeStabilizationStatus === 'stabilization_not_ready'
    || governance?.runtimeGovernanceStatus === 'governance_not_ready'
    || readiness?.runtimeReadinessStatus === 'runtime_not_ready'
    || eligibility?.runtimeEligibilityStatus === 'runtime_not_ready'
    || envelope.envelopeEligibility === 'not_recommended'
    || envelope.normalizedStatus === 'not_evaluated'
  ) return 'activation_withhold';
  if (
    stabilization?.runtimeStabilizationStatus === 'stabilization_conditional'
    || governance?.runtimeGovernanceStatus === 'governance_conditional'
    || readiness?.runtimeReadinessStatus === 'runtime_conditional'
    || eligibility?.runtimeEligibilityStatus === 'runtime_conditional'
    || envelope.envelopeEligibility === 'deferred'
    || envelope.normalizedStatus === 'needs_review'
    || envelope.envelopeRiskSignals.length > 0
    || envelope.envelopeGapSignals.length > 0
  ) return 'activation_hold';
  return 'activation_ready';
}

function confidence(
  status: ValidatorRuntimeActivationState,
  input: ValidatorRuntimeActivationReadinessGateInput,
): ValidatorRuntimeActivationConfidence {
  if (
    status === 'activation_ready'
    && input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationConfidence === 'high'
    && input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'high'
    && input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'high'
    && input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'high'
  ) return 'high';
  if (
    status === 'activation_withhold'
    || input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationConfidence === 'low'
    || input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'low'
    || input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'low'
    || input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeActivationReadinessGateInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function stabilizationFor(input: ValidatorRuntimeActivationReadinessGateInput, sectionIndex: number) {
  return input.validatorRuntimeStabilizationEnvelope.sectionRuntimeStabilization.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function governanceFor(input: ValidatorRuntimeActivationReadinessGateInput, sectionIndex: number) {
  return input.validatorRuntimeGovernanceEnvelope.sectionRuntimeGovernance.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function readinessFor(input: ValidatorRuntimeActivationReadinessGateInput, sectionIndex: number) {
  return input.validatorRuntimeReadinessEnvelope.sectionRuntimeReadiness.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function eligibilityFor(input: ValidatorRuntimeActivationReadinessGateInput, sectionIndex: number) {
  return input.validatorRuntimeEligibilityInterpretation.sectionRuntimeEligibility.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function buildSectionRuntimeActivationReadiness(
  input: ValidatorRuntimeActivationReadinessGateInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeActivationReadiness {
  const trace = traceFor(input, section.sectionIndex);
  const stabilization = stabilizationFor(input, section.sectionIndex);
  const governance = governanceFor(input, section.sectionIndex);
  const readiness = readinessFor(input, section.sectionIndex);
  const eligibility = eligibilityFor(input, section.sectionIndex);
  const status = sectionStatus(stabilization, governance, readiness, eligibility, section);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeActivationStatus: status,
    runtimeActivationRecommendation: recommendationFor(status),
    runtimeActivationDependencies: unique([
      ...(stabilization?.runtimeStabilizationDependencies || []),
      ...(governance?.runtimeGovernanceDependencies || []),
      ...(readiness?.runtimeReadinessDependencies || []),
      ...(eligibility?.runtimeEligibilityDependencies || []),
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeActivationBoundaries: unique([
      ...(stabilization?.runtimeStabilizationBoundaries || []),
      ...(governance?.runtimeGovernanceBoundaries || []),
      ...(readiness?.runtimeReadinessBoundaries || []),
      ...(eligibility?.runtimeEligibilityBoundaries || []),
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeActivationPreservationRequirements: unique([
      ...(stabilization?.runtimeStabilizationPreservationRequirements || []),
      ...(governance?.runtimeGovernancePreservationRequirements || []),
      ...(readiness?.runtimeReadinessPreservationRequirements || []),
      ...(eligibility?.runtimeEligibilityPreservationRequirements || []),
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeActivationVerificationRequirements: unique([
      'runtime activation readiness gate is advisory-only',
      ...(stabilization?.runtimeStabilizationVerificationRequirements || []),
      ...(governance?.runtimeGovernanceVerificationRequirements || []),
      ...(readiness?.runtimeReadinessVerificationRequirements || []),
      ...(eligibility?.runtimeEligibilityVerificationRequirements || []),
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeActivationRiskSignals: unique([
      ...(stabilization?.runtimeStabilizationRiskSignals || []),
      ...(governance?.runtimeGovernanceRiskSignals || []),
      ...(readiness?.runtimeReadinessRiskSignals || []),
      ...(eligibility?.runtimeEligibilityRiskSignals || []),
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    runtimeActivationGapSignals: unique([
      ...(stabilization?.runtimeStabilizationGapSignals || []),
      ...(governance?.runtimeGovernanceGapSignals || []),
      ...(readiness?.runtimeReadinessGapSignals || []),
      ...(eligibility?.runtimeEligibilityGapSignals || []),
      ...section.envelopeGapSignals,
    ], 10),
  };
}

export function buildValidatorRuntimeActivationReadinessGate(
  input: ValidatorRuntimeActivationReadinessGateInput,
): ValidatorRuntimeActivationReadinessGate {
  const sectionRuntimeActivationReadiness = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return buildSectionRuntimeActivationReadiness(input, section);
  });
  const runtimeActivationRiskSignals = unique([
    ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationRiskSignals,
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceRiskSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessRiskSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeActivationGapSignals = unique([
    ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationGapSignals,
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceGapSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessGapSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
  ], 18);
  const runtimeActivationStatus = activationStatus(
    input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationStatus,
    input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceStatus,
    input.validatorRuntimeReadinessEnvelope.runtimeReadinessStatus,
    input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityStatus,
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    runtimeActivationRiskSignals,
    runtimeActivationGapSignals,
  );

  return {
    version: 'validator-runtime-activation-readiness-gate-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRuntimeStabilizationEnvelope.contentType,
    topic: input.validatorRuntimeStabilizationEnvelope.topic,
    overallRuntimeActivationReadiness: runtimeActivationStatus,
    runtimeActivationStatus,
    runtimeActivationInputs: unique([
      'validator runtime stabilization envelope',
      'validator runtime governance envelope',
      'validator runtime readiness envelope',
      'validator runtime eligibility interpretation',
      'normalized validator output envelope',
      'validator decision trace',
    ], 10),
    runtimeActivationDependencies: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationDependencies,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceDependencies,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessDependencies,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
    ], 18),
    runtimeActivationBoundaries: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationBoundaries,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceBoundaries,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessBoundaries,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
    ], 18),
    runtimeActivationPreservationRequirements: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationPreservationRequirements,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernancePreservationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessPreservationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
    ], 18),
    runtimeActivationVerificationRequirements: unique([
      'runtime activation readiness gate is advisory-only and must not gate runtime behavior',
      'runtime activation readiness gate must not execute validators, mutate scores, regenerate content, or enforce outcomes',
      'runtime activation recommendation is advisory and must not trigger validator activation',
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationVerificationRequirements,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceVerificationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessVerificationRequirements,
    ], 18),
    runtimeActivationRiskSignals,
    runtimeActivationGapSignals,
    runtimeActivationInterpretation: {
      allowedStatuses: ['activation_ready', 'activation_hold', 'activation_withhold'],
      allowedRecommendations: ['activate', 'hold', 'withhold'],
      defaultStatus: 'activation_withhold',
      defaultRecommendation: 'withhold',
      advisoryOnly: true,
    },
    runtimeActivationRecommendation: recommendationFor(runtimeActivationStatus),
    sectionRuntimeActivationReadiness,
    runtimeActivationConfidence: confidence(runtimeActivationStatus, input),
  };
}

export function serializeValidatorRuntimeActivationReadinessGate(
  gate: ValidatorRuntimeActivationReadinessGate,
): string {
  return [
    '## VALIDATOR RUNTIME ACTIVATION READINESS GATE',
    `Version: ${gate.version}`,
    `Topic: ${gate.topic}`,
    `Content type: ${gate.contentType}`,
    `Runtime activation: ${gate.overallRuntimeActivationReadiness}`,
    `Runtime activation recommendation: ${gate.runtimeActivationRecommendation}`,
    `Runtime activation confidence: ${gate.runtimeActivationConfidence}`,
    `Allowed statuses: ${gate.runtimeActivationInterpretation.allowedStatuses.join(', ')}`,
    `Section runtime activation entries: ${gate.sectionRuntimeActivationReadiness.length}`,
    `Gap signals: ${gate.runtimeActivationGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
