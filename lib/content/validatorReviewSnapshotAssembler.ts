import type { ValidatorAcceptanceSimulation } from './validatorAcceptanceSimulation';
import type { ValidatorAuditTrail, SectionAuditEvent } from './validatorAuditTrail';
import type { ValidatorDecisionPreparation } from './validatorDecisionPreparation';
import type { ValidatorRecoveryDecisionSequence } from './validatorRecoveryDecisionSequencer';
import type { ValidatorResultContractReport } from './validatorResultContracts';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type ReviewSnapshotReadiness = 'ready' | 'conditional' | 'blocked';
export type ReviewSnapshotConfidence = 'low' | 'medium' | 'high';

export interface SectionReviewSnapshot {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  reviewSnapshot: readonly string[];
  boundarySnapshot: readonly string[];
  preservationSnapshot: readonly string[];
  decisionSnapshot: readonly string[];
}

export interface ValidatorReviewSnapshot {
  version: 'validator-review-snapshot-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallSnapshotReadiness: ReviewSnapshotReadiness;
  reviewSnapshots: readonly string[];
  reviewBoundarySnapshots: readonly string[];
  reviewPreservationSnapshots: readonly string[];
  reviewDecisionSnapshots: readonly string[];
  sectionReviewSnapshots: readonly SectionReviewSnapshot[];
  snapshotRiskProfile: {
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    gaps: number;
    deferred: number;
  };
  snapshotConfidence: ReviewSnapshotConfidence;
}

export interface ValidatorReviewSnapshotInput {
  validatorAuditTrail: ValidatorAuditTrail;
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
  validatorAcceptanceSimulation: ValidatorAcceptanceSimulation;
  validatorDecisionPreparation: ValidatorDecisionPreparation;
  validatorResultContracts: ValidatorResultContractReport;
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

function readiness(input: ValidatorReviewSnapshotInput): ReviewSnapshotReadiness {
  if (
    input.validatorAuditTrail.overallAuditReadiness === 'blocked'
    || input.validatorRecoveryDecisionSequence.overallRecoveryDecisionReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorAuditTrail.overallAuditReadiness === 'conditional'
    || input.validatorRecoveryDecisionSequence.overallRecoveryDecisionReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: ReviewSnapshotReadiness, input: ValidatorReviewSnapshotInput): ReviewSnapshotConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorAuditTrail.auditConfidence === 'high'
    && input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorAuditTrail.auditConfidence === 'low'
    || input.validatorAcceptanceSimulation.acceptanceSimulationConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionSnapshot(event: SectionAuditEvent): SectionReviewSnapshot {
  return {
    sectionIndex: event.sectionIndex,
    progressionStage: event.progressionStage,
    narrativeRole: event.narrativeRole,
    reviewSnapshot: unique(event.eventSequence, 8),
    boundarySnapshot: unique(event.boundaryEvents, 8),
    preservationSnapshot: unique(event.preservationEvents, 8),
    decisionSnapshot: unique(event.decisionEvents, 8),
  };
}

export function assembleValidatorReviewSnapshot(input: ValidatorReviewSnapshotInput): ValidatorReviewSnapshot {
  const overallSnapshotReadiness = readiness(input);
  const sectionReviewSnapshots = input.validatorAuditTrail.sectionAuditEvents.map(sectionSnapshot);

  return {
    version: 'validator-review-snapshot-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorAuditTrail.contentType,
    topic: input.validatorAuditTrail.topic,
    overallSnapshotReadiness,
    reviewSnapshots: unique([
      ...input.validatorAuditTrail.auditEventSequence,
      `result contracts: ${input.validatorResultContracts.sectionValidatorResultContracts.length}`,
      `decision preparations: ${input.validatorDecisionPreparation.sectionDecisionPreparation.length}`,
      `acceptance simulations: ${input.validatorAcceptanceSimulation.sectionAcceptanceSimulations.length}`,
    ], 14),
    reviewBoundarySnapshots: unique(input.validatorAuditTrail.auditBoundaryEvents, 16),
    reviewPreservationSnapshots: unique(input.validatorAuditTrail.auditPreservationEvents, 16),
    reviewDecisionSnapshots: unique(input.validatorAuditTrail.auditDecisionEvents, 16),
    sectionReviewSnapshots,
    snapshotRiskProfile: {
      lowRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.lowRisk,
      mediumRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.mediumRisk,
      highRisk: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.highRisk,
      gaps: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.gaps,
      deferred: input.validatorRecoveryDecisionSequence.recoveryDecisionRiskProfile.deferred,
    },
    snapshotConfidence: confidence(overallSnapshotReadiness, input),
  };
}

export function serializeValidatorReviewSnapshot(snapshot: ValidatorReviewSnapshot): string {
  return [
    '## VALIDATOR REVIEW SNAPSHOT',
    `Version: ${snapshot.version}`,
    `Topic: ${snapshot.topic}`,
    `Content type: ${snapshot.contentType}`,
    `Snapshot readiness: ${snapshot.overallSnapshotReadiness}`,
    `Snapshot confidence: ${snapshot.snapshotConfidence}`,
    `Review snapshots: ${snapshot.reviewSnapshots.length}`,
    `Section snapshots: ${snapshot.sectionReviewSnapshots.length}`,
    `Decision snapshots: ${snapshot.reviewDecisionSnapshots.length}`,
  ].join('\n');
}
