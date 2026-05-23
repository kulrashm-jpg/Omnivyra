import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type {
  NormalizedValidatorOutputEnvelope,
  SectionNormalizedEnvelope,
} from './normalizedValidatorOutputEnvelope';
import type { ValidatorPreflightReadinessGate } from './validatorPreflightReadinessGate';
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

// Final advisory rollout-closure layer. Consolidates every runtime-readiness
// envelope into one deterministic advisory package. Non-executing,
// non-gating, non-mutating — it interprets, it does not act.

export type ValidatorRuntimeRolloutStatus = 'rollout_ready' | 'rollout_conditional' | 'rollout_not_ready';
export type ValidatorRuntimeRolloutConfidence = 'low' | 'medium' | 'high';
export type ValidatorRuntimeRolloutRecommendation =
  | 'safe_for_shadow_only'
  | 'requires_additional_soak'
  | 'requires_runtime_stabilization'
  | 'requires_dependency_resolution'
  | 'not_ready_for_activation_design';

const RECOMMENDATION_ORDER: readonly ValidatorRuntimeRolloutRecommendation[] = [
  'safe_for_shadow_only',
  'requires_additional_soak',
  'requires_runtime_stabilization',
  'requires_dependency_resolution',
  'not_ready_for_activation_design',
];

export interface SectionRuntimeRolloutReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeRolloutStatus: ValidatorRuntimeRolloutStatus;
  runtimeRolloutDependencies: readonly string[];
  runtimeRolloutBoundaries: readonly string[];
  runtimeRolloutPreservationRequirements: readonly string[];
  runtimeRolloutVerificationRequirements: readonly string[];
  runtimeRolloutRiskSignals: readonly string[];
  runtimeRolloutGapSignals: readonly string[];
  runtimeRolloutRecommendations: readonly ValidatorRuntimeRolloutRecommendation[];
  runtimeRolloutConfidence: ValidatorRuntimeRolloutConfidence;
}

export interface ValidatorRuntimeRolloutClosureEnvelope {
  version: 'validator-runtime-rollout-closure-envelope-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeRolloutReadiness: ValidatorRuntimeRolloutStatus;
  runtimeRolloutStatus: ValidatorRuntimeRolloutStatus;
  runtimeRolloutInputs: readonly string[];
  runtimeRolloutDependencies: readonly string[];
  runtimeRolloutBoundaries: readonly string[];
  runtimeRolloutPreservationRequirements: readonly string[];
  runtimeRolloutVerificationRequirements: readonly string[];
  runtimeRolloutRiskSignals: readonly string[];
  runtimeRolloutGapSignals: readonly string[];
  runtimeRolloutInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeRolloutStatus[];
    allowedRecommendations: readonly ValidatorRuntimeRolloutRecommendation[];
    defaultStatus: ValidatorRuntimeRolloutStatus;
    defaultRecommendation: ValidatorRuntimeRolloutRecommendation;
    advisoryOnly: boolean;
  };
  runtimeRolloutRecommendations: readonly ValidatorRuntimeRolloutRecommendation[];
  sectionRuntimeRolloutReadiness: readonly SectionRuntimeRolloutReadiness[];
  runtimeRolloutConfidence: ValidatorRuntimeRolloutConfidence;
}

export interface ValidatorRuntimeRolloutClosureEnvelopeInput {
  validatorRuntimeStabilizationEnvelope: ValidatorRuntimeStabilizationEnvelope;
  validatorRuntimeGovernanceEnvelope: ValidatorRuntimeGovernanceEnvelope;
  validatorRuntimeReadinessEnvelope: ValidatorRuntimeReadinessEnvelope;
  validatorRuntimeEligibilityInterpretation: ValidatorRuntimeEligibilityInterpretation;
  normalizedValidatorOutputEnvelope: NormalizedValidatorOutputEnvelope;
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

function rolloutStatus(
  stabilization: ValidatorRuntimeStabilizationEnvelope['runtimeStabilizationStatus'],
  governance: ValidatorRuntimeGovernanceEnvelope['runtimeGovernanceStatus'],
  readiness: ValidatorRuntimeReadinessEnvelope['runtimeReadinessStatus'],
  eligibility: ValidatorRuntimeEligibilityInterpretation['runtimeEligibilityStatus'],
  envelopeReadiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  preflight: ValidatorPreflightReadinessGate['overallPreflightReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeRolloutStatus {
  if (
    stabilization === 'stabilization_not_ready'
    || governance === 'governance_not_ready'
    || readiness === 'runtime_not_ready'
    || eligibility === 'runtime_not_ready'
    || envelopeReadiness === 'blocked'
    || preflight === 'blocked'
    || gapSignals.length > 2
  ) return 'rollout_not_ready';
  if (
    stabilization === 'stabilization_conditional'
    || governance === 'governance_conditional'
    || readiness === 'runtime_conditional'
    || eligibility === 'runtime_conditional'
    || envelopeReadiness === 'conditional'
    || preflight === 'conditional'
    || riskSignals.length > 0
    || gapSignals.length > 0
  ) return 'rollout_conditional';
  return 'rollout_ready';
}

function deriveRecommendations(
  status: ValidatorRuntimeRolloutStatus,
  stabilizationReady: boolean,
  dependencyGap: boolean,
  riskOrConditional: boolean,
): ValidatorRuntimeRolloutRecommendation[] {
  if (status === 'rollout_ready') return ['safe_for_shadow_only'];
  const selected = new Set<ValidatorRuntimeRolloutRecommendation>();
  if (status === 'rollout_not_ready') selected.add('not_ready_for_activation_design');
  if (!stabilizationReady) selected.add('requires_runtime_stabilization');
  if (dependencyGap) selected.add('requires_dependency_resolution');
  if (riskOrConditional) selected.add('requires_additional_soak');
  if (selected.size === 0) selected.add('requires_additional_soak');
  return RECOMMENDATION_ORDER.filter((recommendation) => selected.has(recommendation));
}

function sectionRolloutStatus(
  stabilization: SectionRuntimeStabilization | undefined,
  governance: SectionRuntimeGovernance | undefined,
  readiness: SectionRuntimeReadiness | undefined,
  eligibility: SectionRuntimeEligibility | undefined,
  envelope: SectionNormalizedEnvelope,
): ValidatorRuntimeRolloutStatus {
  if (
    stabilization?.runtimeStabilizationStatus === 'stabilization_not_ready'
    || governance?.runtimeGovernanceStatus === 'governance_not_ready'
    || readiness?.runtimeReadinessStatus === 'runtime_not_ready'
    || eligibility?.runtimeEligibilityStatus === 'runtime_not_ready'
    || envelope.envelopeEligibility === 'not_recommended'
    || envelope.normalizedStatus === 'not_evaluated'
  ) return 'rollout_not_ready';
  if (
    stabilization?.runtimeStabilizationStatus === 'stabilization_conditional'
    || governance?.runtimeGovernanceStatus === 'governance_conditional'
    || readiness?.runtimeReadinessStatus === 'runtime_conditional'
    || eligibility?.runtimeEligibilityStatus === 'runtime_conditional'
    || envelope.envelopeEligibility === 'deferred'
    || envelope.normalizedStatus === 'needs_review'
    || envelope.envelopeRiskSignals.length > 0
    || envelope.envelopeGapSignals.length > 0
  ) return 'rollout_conditional';
  return 'rollout_ready';
}

function confidence(
  status: ValidatorRuntimeRolloutStatus,
  input: ValidatorRuntimeRolloutClosureEnvelopeInput,
): ValidatorRuntimeRolloutConfidence {
  if (
    status === 'rollout_ready'
    && input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationConfidence === 'high'
    && input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'high'
    && input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'high'
    && input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'high'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
  ) return 'high';
  if (
    status === 'rollout_not_ready'
    || input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationConfidence === 'low'
    || input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceConfidence === 'low'
    || input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'low'
    || input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'low'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionConfidence(status: ValidatorRuntimeRolloutStatus, riskCount: number, gapCount: number): ValidatorRuntimeRolloutConfidence {
  if (status === 'rollout_not_ready') return 'low';
  if (status === 'rollout_ready' && riskCount === 0 && gapCount === 0) return 'high';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeRolloutClosureEnvelopeInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function stabilizationFor(input: ValidatorRuntimeRolloutClosureEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeStabilizationEnvelope.sectionRuntimeStabilization.find((s) => s.sectionIndex === sectionIndex);
}

function governanceFor(input: ValidatorRuntimeRolloutClosureEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeGovernanceEnvelope.sectionRuntimeGovernance.find((s) => s.sectionIndex === sectionIndex);
}

function readinessFor(input: ValidatorRuntimeRolloutClosureEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeReadinessEnvelope.sectionRuntimeReadiness.find((s) => s.sectionIndex === sectionIndex);
}

function eligibilityFor(input: ValidatorRuntimeRolloutClosureEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeEligibilityInterpretation.sectionRuntimeEligibility.find((s) => s.sectionIndex === sectionIndex);
}

function buildSectionRuntimeRolloutReadiness(
  input: ValidatorRuntimeRolloutClosureEnvelopeInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeRolloutReadiness {
  const trace = traceFor(input, section.sectionIndex);
  const stabilization = stabilizationFor(input, section.sectionIndex);
  const governance = governanceFor(input, section.sectionIndex);
  const readiness = readinessFor(input, section.sectionIndex);
  const eligibility = eligibilityFor(input, section.sectionIndex);
  const status = sectionRolloutStatus(stabilization, governance, readiness, eligibility, section);

  const runtimeRolloutGapSignals = unique([
    ...(stabilization?.runtimeStabilizationGapSignals || []),
    ...(governance?.runtimeGovernanceGapSignals || []),
    ...(readiness?.runtimeReadinessGapSignals || []),
    ...(eligibility?.runtimeEligibilityGapSignals || []),
    ...section.envelopeGapSignals,
  ], 10);
  const runtimeRolloutRiskSignals = unique([
    ...(stabilization?.runtimeStabilizationRiskSignals || []),
    ...(governance?.runtimeGovernanceRiskSignals || []),
    ...(readiness?.runtimeReadinessRiskSignals || []),
    ...(eligibility?.runtimeEligibilityRiskSignals || []),
    ...section.envelopeRiskSignals,
    ...(trace?.riskTrace || []),
  ], 10);

  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeRolloutStatus: status,
    runtimeRolloutDependencies: unique([
      ...(stabilization?.runtimeStabilizationDependencies || []),
      ...(governance?.runtimeGovernanceDependencies || []),
      ...(readiness?.runtimeReadinessDependencies || []),
      ...(eligibility?.runtimeEligibilityDependencies || []),
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeRolloutBoundaries: unique([
      ...(stabilization?.runtimeStabilizationBoundaries || []),
      ...(governance?.runtimeGovernanceBoundaries || []),
      ...(readiness?.runtimeReadinessBoundaries || []),
      ...(eligibility?.runtimeEligibilityBoundaries || []),
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeRolloutPreservationRequirements: unique([
      ...(stabilization?.runtimeStabilizationPreservationRequirements || []),
      ...(governance?.runtimeGovernancePreservationRequirements || []),
      ...(readiness?.runtimeReadinessPreservationRequirements || []),
      ...(eligibility?.runtimeEligibilityPreservationRequirements || []),
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeRolloutVerificationRequirements: unique([
      'runtime rollout closure envelope is advisory-only',
      ...(stabilization?.runtimeStabilizationVerificationRequirements || []),
      ...(governance?.runtimeGovernanceVerificationRequirements || []),
      ...(readiness?.runtimeReadinessVerificationRequirements || []),
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeRolloutRiskSignals,
    runtimeRolloutGapSignals,
    runtimeRolloutRecommendations: deriveRecommendations(
      status,
      stabilization?.runtimeStabilizationStatus === 'stabilization_ready',
      runtimeRolloutGapSignals.length > 0,
      runtimeRolloutRiskSignals.length > 0 || status === 'rollout_conditional',
    ),
    runtimeRolloutConfidence: sectionConfidence(status, runtimeRolloutRiskSignals.length, runtimeRolloutGapSignals.length),
  };
}

export function buildValidatorRuntimeRolloutClosureEnvelope(
  input: ValidatorRuntimeRolloutClosureEnvelopeInput,
): ValidatorRuntimeRolloutClosureEnvelope {
  const sectionRuntimeRolloutReadiness = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map(
    (section) => buildSectionRuntimeRolloutReadiness(input, section),
  );

  const runtimeRolloutRiskSignals = unique([
    ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationRiskSignals,
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceRiskSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessRiskSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorPreflightReadinessGate.preflightRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeRolloutGapSignals = unique([
    ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationGapSignals,
    ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceGapSignals,
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessGapSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
    ...input.validatorPreflightReadinessGate.preflightGapSignals,
  ], 18);

  const runtimeRolloutStatus = rolloutStatus(
    input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationStatus,
    input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceStatus,
    input.validatorRuntimeReadinessEnvelope.runtimeReadinessStatus,
    input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityStatus,
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    input.validatorPreflightReadinessGate.overallPreflightReadiness,
    runtimeRolloutRiskSignals,
    runtimeRolloutGapSignals,
  );

  const runtimeRolloutRecommendations = deriveRecommendations(
    runtimeRolloutStatus,
    input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationStatus === 'stabilization_ready',
    runtimeRolloutGapSignals.length > 0,
    runtimeRolloutRiskSignals.length > 0 || runtimeRolloutStatus === 'rollout_conditional',
  );

  return {
    version: 'validator-runtime-rollout-closure-envelope-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRuntimeStabilizationEnvelope.contentType,
    topic: input.validatorRuntimeStabilizationEnvelope.topic,
    overallRuntimeRolloutReadiness: runtimeRolloutStatus,
    runtimeRolloutStatus,
    runtimeRolloutInputs: unique([
      'validator runtime stabilization envelope',
      'validator runtime governance envelope',
      'validator runtime readiness envelope',
      'validator runtime eligibility interpretation',
      'normalized validator output envelope',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    runtimeRolloutDependencies: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationDependencies,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceDependencies,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessDependencies,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    runtimeRolloutBoundaries: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationBoundaries,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceBoundaries,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessBoundaries,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    runtimeRolloutPreservationRequirements: unique([
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationPreservationRequirements,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernancePreservationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessPreservationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    runtimeRolloutVerificationRequirements: unique([
      'runtime rollout closure envelope is advisory-only and must not gate runtime behavior',
      'runtime rollout closure envelope must not execute validators, mutate scores, regenerate content, or enforce outcomes',
      'runtime rollout recommendations are advisory and must not trigger activation',
      ...input.validatorRuntimeStabilizationEnvelope.runtimeStabilizationVerificationRequirements,
      ...input.validatorRuntimeGovernanceEnvelope.runtimeGovernanceVerificationRequirements,
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessVerificationRequirements,
    ], 18),
    runtimeRolloutRiskSignals,
    runtimeRolloutGapSignals,
    runtimeRolloutInterpretation: {
      allowedStatuses: ['rollout_ready', 'rollout_conditional', 'rollout_not_ready'],
      allowedRecommendations: RECOMMENDATION_ORDER,
      defaultStatus: 'rollout_not_ready',
      defaultRecommendation: 'not_ready_for_activation_design',
      advisoryOnly: true,
    },
    runtimeRolloutRecommendations,
    sectionRuntimeRolloutReadiness,
    runtimeRolloutConfidence: confidence(runtimeRolloutStatus, input),
  };
}

export function serializeValidatorRuntimeRolloutClosureEnvelope(
  envelope: ValidatorRuntimeRolloutClosureEnvelope,
): string {
  return [
    '## VALIDATOR RUNTIME ROLLOUT CLOSURE ENVELOPE',
    `Version: ${envelope.version}`,
    `Topic: ${envelope.topic}`,
    `Content type: ${envelope.contentType}`,
    `Runtime rollout: ${envelope.overallRuntimeRolloutReadiness}`,
    `Runtime rollout confidence: ${envelope.runtimeRolloutConfidence}`,
    `Recommendations: ${envelope.runtimeRolloutRecommendations.join(', ')}`,
    `Allowed statuses: ${envelope.runtimeRolloutInterpretation.allowedStatuses.join(', ')}`,
    `Section rollout entries: ${envelope.sectionRuntimeRolloutReadiness.length}`,
    `Risk signals: ${envelope.runtimeRolloutRiskSignals.join('; ') || 'none'}`,
    `Gap signals: ${envelope.runtimeRolloutGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
