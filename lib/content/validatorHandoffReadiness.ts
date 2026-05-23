import type { ValidatorAuditTrail } from './validatorAuditTrail';
import type { ValidatorCoverageLedger } from './validatorCoverageLedger';
import type { ValidatorDecisionTrace } from './validatorDecisionTrace';
import type { ValidatorRecoveryDecisionSequence } from './validatorRecoveryDecisionSequencer';
import type { ValidatorReviewSnapshot } from './validatorReviewSnapshotAssembler';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorHandoffReadinessState = 'ready' | 'conditional' | 'blocked';
export type ValidatorHandoffEligibility = 'eligible' | 'deferred' | 'not_recommended';
export type ValidatorHandoffConfidence = 'low' | 'medium' | 'high';

export interface SectionHandoffReadiness {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  handoffEligibility: ValidatorHandoffEligibility;
  dependencySignals: readonly string[];
  boundarySignals: readonly string[];
  preservationSignals: readonly string[];
  riskSignals: readonly string[];
}

export interface ValidatorHandoffReadiness {
  version: 'validator-handoff-readiness-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallHandoffReadiness: ValidatorHandoffReadinessState;
  handoffEligibility: ValidatorHandoffEligibility;
  handoffDependencySignals: readonly string[];
  handoffBoundarySignals: readonly string[];
  handoffPreservationSignals: readonly string[];
  handoffRiskSignals: readonly string[];
  sectionHandoffReadiness: readonly SectionHandoffReadiness[];
  handoffConfidence: ValidatorHandoffConfidence;
}

export interface ValidatorHandoffReadinessInput {
  validatorDecisionTrace: ValidatorDecisionTrace;
  validatorCoverageLedger: ValidatorCoverageLedger;
  validatorReviewSnapshot: ValidatorReviewSnapshot;
  validatorAuditTrail: ValidatorAuditTrail;
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
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

function readiness(input: ValidatorHandoffReadinessInput): ValidatorHandoffReadinessState {
  if (
    input.validatorDecisionTrace.overallDecisionTraceReadiness === 'blocked'
    || input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'blocked'
    || input.validatorAuditTrail.overallAuditReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorDecisionTrace.overallDecisionTraceReadiness === 'conditional'
    || input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'conditional'
    || input.validatorAuditTrail.overallAuditReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function eligibility(readinessValue: ValidatorHandoffReadinessState, riskSignals: readonly string[]): ValidatorHandoffEligibility {
  if (readinessValue === 'blocked') return 'not_recommended';
  if (readinessValue === 'conditional' || riskSignals.length > 0) return 'deferred';
  return 'eligible';
}

function confidence(readinessValue: ValidatorHandoffReadinessState, input: ValidatorHandoffReadinessInput): ValidatorHandoffConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorDecisionTrace.decisionTraceConfidence === 'high'
    && input.validatorCoverageLedger.coverageLedgerConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorDecisionTrace.decisionTraceConfidence === 'low'
    || input.validatorCoverageLedger.coverageLedgerConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionReadiness(input: ValidatorHandoffReadinessInput): SectionHandoffReadiness[] {
  return input.validatorDecisionTrace.sectionDecisionTraces.map((section) => {
    const plan = input.validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans.find((item) => item.sectionIndex === section.sectionIndex);
    const riskSignals = unique([
      ...section.riskTrace,
      ...(plan?.deferralSignals || []),
    ], 8);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      handoffEligibility: plan?.recoveryDecisionEligibility === 'not_recommended'
        ? 'not_recommended'
        : riskSignals.length > 0 || plan?.recoveryDecisionEligibility === 'deferred'
          ? 'deferred'
          : 'eligible',
      dependencySignals: unique(section.dependencyTrace, 10),
      boundarySignals: unique(section.boundaryTrace, 10),
      preservationSignals: unique(section.preservationTrace, 10),
      riskSignals,
    };
  });
}

export function buildValidatorHandoffReadiness(input: ValidatorHandoffReadinessInput): ValidatorHandoffReadiness {
  const overallHandoffReadiness = readiness(input);
  const handoffRiskSignals = unique([
    ...input.validatorDecisionTrace.decisionTraceRiskSignals,
    ...input.validatorAuditTrail.auditRiskProfile.deferred > 0 ? [`deferred audit events: ${input.validatorAuditTrail.auditRiskProfile.deferred}`] : [],
  ], 16);
  const sectionHandoffReadiness = sectionReadiness(input);

  return {
    version: 'validator-handoff-readiness-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorDecisionTrace.contentType,
    topic: input.validatorDecisionTrace.topic,
    overallHandoffReadiness,
    handoffEligibility: eligibility(overallHandoffReadiness, handoffRiskSignals),
    handoffDependencySignals: unique([
      ...input.validatorDecisionTrace.decisionTraceDependencies,
      ...input.validatorRecoveryDecisionSequence.recoveryDependencyOrdering,
    ], 18),
    handoffBoundarySignals: unique(input.validatorDecisionTrace.decisionTraceBoundaries, 18),
    handoffPreservationSignals: unique(input.validatorDecisionTrace.decisionTracePreservationSignals, 18),
    handoffRiskSignals,
    sectionHandoffReadiness,
    handoffConfidence: confidence(overallHandoffReadiness, input),
  };
}

export function serializeValidatorHandoffReadiness(readinessReport: ValidatorHandoffReadiness): string {
  return [
    '## VALIDATOR HANDOFF READINESS',
    `Version: ${readinessReport.version}`,
    `Topic: ${readinessReport.topic}`,
    `Content type: ${readinessReport.contentType}`,
    `Handoff readiness: ${readinessReport.overallHandoffReadiness}`,
    `Handoff eligibility: ${readinessReport.handoffEligibility}`,
    `Handoff confidence: ${readinessReport.handoffConfidence}`,
    `Section handoff entries: ${readinessReport.sectionHandoffReadiness.length}`,
    `Boundary signals: ${readinessReport.handoffBoundarySignals.length}`,
  ].join('\n');
}
