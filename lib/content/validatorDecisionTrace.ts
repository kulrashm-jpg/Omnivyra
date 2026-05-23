import type { ValidatorAuditTrail } from './validatorAuditTrail';
import type { ValidatorCoverageLedger } from './validatorCoverageLedger';
import type { ValidatorDecisionPreparation } from './validatorDecisionPreparation';
import type { ValidatorRecoveryDecisionSequence } from './validatorRecoveryDecisionSequencer';
import type { ValidatorReviewSnapshot } from './validatorReviewSnapshotAssembler';
import type { NarrativePlanningSection, NarrativeProgressionStage } from './narrativePlanningEngine';

export type DecisionTraceReadiness = 'ready' | 'conditional' | 'blocked';
export type DecisionTraceConfidence = 'low' | 'medium' | 'high';

export interface SectionDecisionTrace {
  sectionIndex: number;
  progressionStage: NarrativeProgressionStage;
  narrativeRole: NarrativePlanningSection['narrativeRole'];
  decisionTrace: readonly string[];
  dependencyTrace: readonly string[];
  boundaryTrace: readonly string[];
  preservationTrace: readonly string[];
  riskTrace: readonly string[];
}

export interface ValidatorDecisionTrace {
  version: 'validator-decision-trace-v1';
  generatedAt: string;
  contentType: string;
  topic: string;
  overallDecisionTraceReadiness: DecisionTraceReadiness;
  decisionTraceSequence: readonly string[];
  decisionTraceDependencies: readonly string[];
  decisionTraceBoundaries: readonly string[];
  decisionTracePreservationSignals: readonly string[];
  decisionTraceRiskSignals: readonly string[];
  sectionDecisionTraces: readonly SectionDecisionTrace[];
  decisionTraceConfidence: DecisionTraceConfidence;
}

export interface ValidatorDecisionTraceInput {
  validatorCoverageLedger: ValidatorCoverageLedger;
  validatorReviewSnapshot: ValidatorReviewSnapshot;
  validatorAuditTrail: ValidatorAuditTrail;
  validatorRecoveryDecisionSequence: ValidatorRecoveryDecisionSequence;
  validatorDecisionPreparation: ValidatorDecisionPreparation;
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

function readiness(input: ValidatorDecisionTraceInput): DecisionTraceReadiness {
  if (
    input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'blocked'
    || input.validatorAuditTrail.overallAuditReadiness === 'blocked'
  ) return 'blocked';
  if (
    input.validatorCoverageLedger.overallCoverageLedgerReadiness === 'conditional'
    || input.validatorAuditTrail.overallAuditReadiness === 'conditional'
  ) return 'conditional';
  return 'ready';
}

function confidence(readinessValue: DecisionTraceReadiness, input: ValidatorDecisionTraceInput): DecisionTraceConfidence {
  if (
    readinessValue === 'ready'
    && input.validatorCoverageLedger.coverageLedgerConfidence === 'high'
    && input.validatorReviewSnapshot.snapshotConfidence === 'high'
  ) return 'high';
  if (
    readinessValue === 'blocked'
    || input.validatorCoverageLedger.coverageLedgerConfidence === 'low'
    || input.validatorReviewSnapshot.snapshotConfidence === 'low'
  ) return 'low';
  return 'medium';
}

function sectionTrace(input: ValidatorDecisionTraceInput) {
  return input.validatorCoverageLedger.sectionCoverageLedger.map((section) => {
    const decisionPlan = input.validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans.find((plan) => plan.sectionIndex === section.sectionIndex);
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      decisionTrace: unique([
        ...section.decisionCoverage,
        ...(decisionPlan ? [`recovery decision priority: ${decisionPlan.recoveryDecisionPriority}`] : []),
      ], 10),
      dependencyTrace: unique(section.dependencyCoverage, 10),
      boundaryTrace: unique(section.boundaryCoverage, 10),
      preservationTrace: unique(section.preservationCoverage, 10),
      riskTrace: unique(decisionPlan?.deferralSignals || [], 8),
    };
  });
}

export function buildValidatorDecisionTrace(input: ValidatorDecisionTraceInput): ValidatorDecisionTrace {
  const overallDecisionTraceReadiness = readiness(input);
  const sectionDecisionTraces = sectionTrace(input);

  return {
    version: 'validator-decision-trace-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: input.validatorCoverageLedger.contentType,
    topic: input.validatorCoverageLedger.topic,
    overallDecisionTraceReadiness,
    decisionTraceSequence: unique([
      ...input.validatorAuditTrail.auditEventSequence,
      ...input.validatorRecoveryDecisionSequence.recoveryDecisionSequence.map((sectionIndex) => `decision section: ${sectionIndex}`),
    ], 18),
    decisionTraceDependencies: unique(input.validatorCoverageLedger.dependencyCoverageLedger, 18),
    decisionTraceBoundaries: unique(input.validatorCoverageLedger.boundaryCoverageLedger, 18),
    decisionTracePreservationSignals: unique(input.validatorCoverageLedger.preservationCoverageLedger, 18),
    decisionTraceRiskSignals: unique([
      ...input.validatorDecisionPreparation.decisionRiskSignals,
      ...input.validatorRecoveryDecisionSequence.recoveryDeferralOrdering.map((sectionIndex) => `deferred recovery decision: ${sectionIndex}`),
    ], 18),
    sectionDecisionTraces,
    decisionTraceConfidence: confidence(overallDecisionTraceReadiness, input),
  };
}

export function serializeValidatorDecisionTrace(trace: ValidatorDecisionTrace): string {
  return [
    '## VALIDATOR DECISION TRACE',
    `Version: ${trace.version}`,
    `Topic: ${trace.topic}`,
    `Content type: ${trace.contentType}`,
    `Trace readiness: ${trace.overallDecisionTraceReadiness}`,
    `Trace confidence: ${trace.decisionTraceConfidence}`,
    `Trace sequence: ${trace.decisionTraceSequence.length}`,
    `Section traces: ${trace.sectionDecisionTraces.length}`,
    `Boundary traces: ${trace.decisionTraceBoundaries.length}`,
  ].join('\n');
}
