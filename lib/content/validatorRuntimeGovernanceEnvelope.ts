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
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorRuntimeGovernanceState = 'governance_ready' | 'governance_conditional' | 'governance_not_ready';
export type ValidatorRuntimeGovernanceConfidence = 'low' | 'medium' | 'high';

export interface SectionRuntimeGovernance {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  runtimeGovernanceStatus: ValidatorRuntimeGovernanceState;
  runtimeGovernanceDependencies: readonly string[];
  runtimeGovernanceBoundaries: readonly string[];
  runtimeGovernancePreservationRequirements: readonly string[];
  runtimeGovernanceVerificationRequirements: readonly string[];
  runtimeGovernanceRiskSignals: readonly string[];
  runtimeGovernanceGapSignals: readonly string[];
}

export interface ValidatorRuntimeGovernanceEnvelope {
  version: 'validator-runtime-governance-envelope-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallRuntimeGovernanceReadiness: ValidatorRuntimeGovernanceState;
  runtimeGovernanceStatus: ValidatorRuntimeGovernanceState;
  runtimeGovernanceInputs: readonly string[];
  runtimeGovernanceDependencies: readonly string[];
  runtimeGovernanceBoundaries: readonly string[];
  runtimeGovernancePreservationRequirements: readonly string[];
  runtimeGovernanceVerificationRequirements: readonly string[];
  runtimeGovernanceRiskSignals: readonly string[];
  runtimeGovernanceGapSignals: readonly string[];
  runtimeGovernanceInterpretation: {
    allowedStatuses: readonly ValidatorRuntimeGovernanceState[];
    defaultStatus: ValidatorRuntimeGovernanceState;
    advisoryOnly: boolean;
  };
  sectionRuntimeGovernance: readonly SectionRuntimeGovernance[];
  runtimeGovernanceConfidence: ValidatorRuntimeGovernanceConfidence;
}

export interface ValidatorRuntimeGovernanceEnvelopeInput {
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

function governanceStatus(
  readinessStatus: ValidatorRuntimeReadinessEnvelope['runtimeReadinessStatus'],
  eligibilityStatus: ValidatorRuntimeEligibilityInterpretation['runtimeEligibilityStatus'],
  envelopeReadiness: NormalizedValidatorOutputEnvelope['overallNormalizedEnvelopeReadiness'],
  riskSignals: readonly string[],
  gapSignals: readonly string[],
): ValidatorRuntimeGovernanceState {
  if (
    readinessStatus === 'runtime_not_ready'
    || eligibilityStatus === 'runtime_not_ready'
    || envelopeReadiness === 'blocked'
    || gapSignals.length > 2
  ) return 'governance_not_ready';
  if (
    readinessStatus === 'runtime_conditional'
    || eligibilityStatus === 'runtime_conditional'
    || envelopeReadiness === 'conditional'
    || riskSignals.length > 0
    || gapSignals.length > 0
  ) return 'governance_conditional';
  return 'governance_ready';
}

function sectionStatus(
  readiness: SectionRuntimeReadiness | undefined,
  eligibility: SectionRuntimeEligibility | undefined,
  envelope: SectionNormalizedEnvelope,
): ValidatorRuntimeGovernanceState {
  if (
    readiness?.runtimeReadinessStatus === 'runtime_not_ready'
    || eligibility?.runtimeEligibilityStatus === 'runtime_not_ready'
    || envelope.envelopeEligibility === 'not_recommended'
    || envelope.normalizedStatus === 'not_evaluated'
  ) return 'governance_not_ready';
  if (
    readiness?.runtimeReadinessStatus === 'runtime_conditional'
    || eligibility?.runtimeEligibilityStatus === 'runtime_conditional'
    || envelope.envelopeEligibility === 'deferred'
    || envelope.normalizedStatus === 'needs_review'
    || envelope.envelopeRiskSignals.length > 0
    || envelope.envelopeGapSignals.length > 0
  ) return 'governance_conditional';
  return 'governance_ready';
}

function confidence(
  status: ValidatorRuntimeGovernanceState,
  input: ValidatorRuntimeGovernanceEnvelopeInput,
): ValidatorRuntimeGovernanceConfidence {
  if (
    status === 'governance_ready'
    && input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'high'
    && input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'high'
    && input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'high'
    && input.validatorPreflightReadinessGate.preflightConfidence === 'high'
  ) return 'high';
  if (
    status === 'governance_not_ready'
    || input.validatorRuntimeReadinessEnvelope.runtimeReadinessConfidence === 'low'
    || input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityConfidence === 'low'
    || input.normalizedValidatorOutputEnvelope.normalizedEnvelopeConfidence === 'low'
    || input.validatorPreflightReadinessGate.preflightConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function traceFor(input: ValidatorRuntimeGovernanceEnvelopeInput, sectionIndex: number) {
  return input.validatorDecisionTrace.sectionDecisionTraces.find((section) => section.sectionIndex === sectionIndex);
}

function readinessFor(input: ValidatorRuntimeGovernanceEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeReadinessEnvelope.sectionRuntimeReadiness.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function eligibilityFor(input: ValidatorRuntimeGovernanceEnvelopeInput, sectionIndex: number) {
  return input.validatorRuntimeEligibilityInterpretation.sectionRuntimeEligibility.find((section) => {
    return section.sectionIndex === sectionIndex;
  });
}

function buildSectionRuntimeGovernance(
  input: ValidatorRuntimeGovernanceEnvelopeInput,
  section: SectionNormalizedEnvelope,
): SectionRuntimeGovernance {
  const trace = traceFor(input, section.sectionIndex);
  const readiness = readinessFor(input, section.sectionIndex);
  const eligibility = eligibilityFor(input, section.sectionIndex);
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    runtimeGovernanceStatus: sectionStatus(readiness, eligibility, section),
    runtimeGovernanceDependencies: unique([
      ...(readiness?.runtimeReadinessDependencies || []),
      ...(eligibility?.runtimeEligibilityDependencies || []),
      ...section.envelopeDependencies,
      ...(trace?.dependencyTrace || []),
    ], 12),
    runtimeGovernanceBoundaries: unique([
      ...(readiness?.runtimeReadinessBoundaries || []),
      ...(eligibility?.runtimeEligibilityBoundaries || []),
      ...section.envelopeBoundaries,
      ...(trace?.boundaryTrace || []),
    ], 12),
    runtimeGovernancePreservationRequirements: unique([
      ...(readiness?.runtimeReadinessPreservationRequirements || []),
      ...(eligibility?.runtimeEligibilityPreservationRequirements || []),
      ...section.envelopePreservationRequirements,
      ...(trace?.preservationTrace || []),
    ], 12),
    runtimeGovernanceVerificationRequirements: unique([
      'runtime governance envelope is advisory-only',
      ...(readiness?.runtimeReadinessVerificationRequirements || []),
      ...(eligibility?.runtimeEligibilityVerificationRequirements || []),
      ...section.envelopeVerificationRequirements,
    ], 14),
    runtimeGovernanceRiskSignals: unique([
      ...(readiness?.runtimeReadinessRiskSignals || []),
      ...(eligibility?.runtimeEligibilityRiskSignals || []),
      ...section.envelopeRiskSignals,
      ...(trace?.riskTrace || []),
    ], 10),
    runtimeGovernanceGapSignals: unique([
      ...(readiness?.runtimeReadinessGapSignals || []),
      ...(eligibility?.runtimeEligibilityGapSignals || []),
      ...section.envelopeGapSignals,
    ], 10),
  };
}

export function buildValidatorRuntimeGovernanceEnvelope(
  input: ValidatorRuntimeGovernanceEnvelopeInput,
): ValidatorRuntimeGovernanceEnvelope {
  const sectionRuntimeGovernance = input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes.map((section) => {
    return buildSectionRuntimeGovernance(input, section);
  });
  const runtimeGovernanceRiskSignals = unique([
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessRiskSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityRiskSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeRiskSignals,
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
  ], 18);
  const runtimeGovernanceGapSignals = unique([
    ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessGapSignals,
    ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityGapSignals,
    ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeGapSignals,
    ...input.validatorPreflightReadinessGate.preflightGapSignals,
  ], 18);
  const runtimeGovernanceStatus = governanceStatus(
    input.validatorRuntimeReadinessEnvelope.runtimeReadinessStatus,
    input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityStatus,
    input.normalizedValidatorOutputEnvelope.overallNormalizedEnvelopeReadiness,
    runtimeGovernanceRiskSignals,
    runtimeGovernanceGapSignals,
  );

  return {
    version: 'validator-runtime-governance-envelope-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRuntimeReadinessEnvelope.contentType,
    topic: input.validatorRuntimeReadinessEnvelope.topic,
    overallRuntimeGovernanceReadiness: runtimeGovernanceStatus,
    runtimeGovernanceStatus,
    runtimeGovernanceInputs: unique([
      'validator runtime readiness envelope',
      'validator runtime eligibility interpretation',
      'normalized validator output envelope',
      'validator preflight readiness gate',
      'validator decision trace',
    ], 10),
    runtimeGovernanceDependencies: unique([
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessDependencies,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityDependencies,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeDependencies,
      ...input.validatorPreflightReadinessGate.preflightDependencyCoverage,
    ], 18),
    runtimeGovernanceBoundaries: unique([
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessBoundaries,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityBoundaries,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeBoundaries,
      ...input.validatorPreflightReadinessGate.preflightBoundaryCoverage,
    ], 18),
    runtimeGovernancePreservationRequirements: unique([
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessPreservationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityPreservationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopePreservationRequirements,
      ...input.validatorPreflightReadinessGate.preflightPreservationCoverage,
    ], 18),
    runtimeGovernanceVerificationRequirements: unique([
      'runtime governance envelope is advisory-only and must not gate runtime behavior',
      'runtime governance envelope must not execute validators, mutate scores, regenerate content, or enforce outcomes',
      ...input.validatorRuntimeReadinessEnvelope.runtimeReadinessVerificationRequirements,
      ...input.validatorRuntimeEligibilityInterpretation.runtimeEligibilityVerificationRequirements,
      ...input.normalizedValidatorOutputEnvelope.normalizedEnvelopeVerificationRequirements,
    ], 18),
    runtimeGovernanceRiskSignals,
    runtimeGovernanceGapSignals,
    runtimeGovernanceInterpretation: {
      allowedStatuses: ['governance_ready', 'governance_conditional', 'governance_not_ready'],
      defaultStatus: 'governance_not_ready',
      advisoryOnly: true,
    },
    sectionRuntimeGovernance,
    runtimeGovernanceConfidence: confidence(runtimeGovernanceStatus, input),
  };
}

export function serializeValidatorRuntimeGovernanceEnvelope(envelope: ValidatorRuntimeGovernanceEnvelope): string {
  return [
    '## VALIDATOR RUNTIME GOVERNANCE ENVELOPE',
    `Version: ${envelope.version}`,
    `Topic: ${envelope.topic}`,
    `Content type: ${envelope.contentType}`,
    `Runtime governance: ${envelope.overallRuntimeGovernanceReadiness}`,
    `Runtime governance confidence: ${envelope.runtimeGovernanceConfidence}`,
    `Allowed statuses: ${envelope.runtimeGovernanceInterpretation.allowedStatuses.join(', ')}`,
    `Section runtime governance entries: ${envelope.sectionRuntimeGovernance.length}`,
    `Gap signals: ${envelope.runtimeGovernanceGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
