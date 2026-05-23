import type { ValidatorAcceptanceSimulation } from './validatorAcceptanceSimulation';
import type { ValidatorDecisionPreparation } from './validatorDecisionPreparation';
import type { ValidatorResultContractReport } from './validatorResultContracts';
import type { ValidatorRecoveryDecisionSequence, SectionRecoveryDecisionPlan } from './validatorRecoveryDecisionSequencer';
import type { ValidatorReviewSequence } from './validatorReviewSequencer';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ValidatorAuditReadiness = 'ready' | 'conditional' | 'blocked';
export type ValidatorAuditConfidence = 'low' | 'medium' | 'high';

export interface SectionAuditEvent {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  eventSequence: readonly string[];
  boundaryEvents: readonly string[];
  preservationEvents: readonly string[];
  dependencyEvents: readonly string[];
  decisionEvents: readonly string[];
}

export interface ValidatorAuditTrail {
  version: 'validator-audit-trail-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallAuditReadiness: ValidatorAuditReadiness;
  auditEventSequence: readonly string[];
  auditBoundaryEvents: readonly string[];
  auditPreservationEvents: readonly string[];
  auditDependencyEvents: readonly string[];
  auditDecisionEvents: readonly string[];
  sectionAuditEvents: readonly SectionAuditEvent[];
  auditRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  auditConfidence: ValidatorAuditConfidence;
}

export interface ValidatorAuditTrailInput {
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
  validatorAcceptanceSimulation: ValidatorAcceptanceSimulation;
  validatorDecisionPreparation: ValidatorDecisionPreparation;
  validatorResultContracts: ValidatorResultContractReport;
  validatorReviewSequence: ValidatorReviewSequence;
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

function readiness(input: ValidatorAuditTrailInput): ValidatorAuditReadiness {
  if (
    input.validatorRecoveryDecisionSequence.overallRecoveryDecisionReadiness === 'blocked'
    || input.validatorAcceptanceSimulation.overallAcceptanceSimulationReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorRecoveryDecisionSequence.overallRecoveryDecisionReadiness === 'conditional'
    || input.validatorAcceptanceSimulation.overallAcceptanceSimulationReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ValidatorAuditReadiness, input: ValidatorAuditTrailInput): ValidatorAuditConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorRecoveryDecisionSequence.recoveryDecisionConfidence === 'high'
    && input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorRecoveryDecisionSequence.recoveryDecisionConfidence === 'low'
    || input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionEvent(section: SectionRecoveryDecisionPlan): SectionAuditEvent {
  return {
    sectionIndex: section.sectionIndex,
    progressionStage: section.progressionStage,
    narrativeRole: section.narrativeRole,
    eventSequence: unique([
      `section ${section.sectionIndex} recovery decision eligibility: ${section.recoveryDecisionEligibility}`,
      `section ${section.sectionIndex} recovery decision priority: ${section.recoveryDecisionPriority}`,
    ], 8),
    boundaryEvents: unique(section.boundarySignals, 10),
    preservationEvents: unique(section.preservationSignals, 10),
    dependencyEvents: unique(section.dependencySignals, 10),
    decisionEvents: unique([
      `decision priority: ${section.recoveryDecisionPriority}`,
      ...section.deferralSignals,
    ], 8),
  };
}

export function buildValidatorAuditTrail(input: ValidatorAuditTrailInput): ValidatorAuditTrail {
  const overallAuditReadiness = readiness(input);
  const sectionAuditEvents = input.validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans.map(sectionEvent);

  return {
    version: 'validator-audit-trail-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorRecoveryDecisionSequence.contentType,
    topic: input.validatorRecoveryDecisionSequence.topic,
    overallAuditReadiness,
    auditEventSequence: unique([
      `review sequence readiness: ${input.validatorReviewSequence.overallReviewSequenceReadiness}`,
      `result readiness: ${input.validatorResultContracts.overallValidatorResultReadiness}`,
      `decision preparation readiness: ${input.validatorDecisionPreparation.overallDecisionPreparationReadiness}`,
      `acceptance simulation readiness: ${input.validatorAcceptanceSimulation.overallAcceptanceSimulationReadiness}`,
      `recovery decision readiness: ${input.validatorRecoveryDecisionSequence.overallRecoveryDecisionReadiness}`,
    ], 10),
    auditBoundaryEvents: unique(sectionAuditEvents.flatMap((section) => section.boundaryEvents), 18),
    auditPreservationEvents: unique(sectionAuditEvents.flatMap((section) => section.preservationEvents), 18),
    auditDependencyEvents: unique(input.validatorRecoveryDecisionSequence.recoveryDependencyOrdering, 18),
    auditDecisionEvents: unique(sectionAuditEvents.flatMap((section) => section.decisionEvents), 18),
    sectionAuditEvents,
    auditRiskProfile: {
      lowRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.lowRisk,
      mediumRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.mediumRisk,
      highRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.highRisk,
      gaps: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.gaps,
      deferred: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.deferred,
    },
    auditConfidence: confidence(overallAuditReadiness, input),
  };
}

export function serializeValidatorAuditTrail(trail: ValidatorAuditTrail): string {
  return [
    '## VALIDATOR AUDIT TRAIL',
    `Version: ${trail.version}`,
    `Topic: ${trail.topic}`,
    `Content type: ${trail.contentType}`,
    `Audit readiness: ${trail.overallAuditReadiness}`,
    `Audit confidence: ${trail.auditConfidence}`,
    `Audit events: ${trail.auditEventSequence.length}`,
    `Section audit events: ${trail.sectionAuditEvents.length}`,
    `Boundary events: ${trail.auditBoundaryEvents.length}`,
  ].join('\n');
}
