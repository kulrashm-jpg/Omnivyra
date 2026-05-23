import {
  buildValidatorAuditTrail,
  serializeValidatorAuditTrail,
} from '../../../lib/content/validatorAuditTrail';
import {
  assembleValidatorReviewSnapshot,
  serializeValidatorReviewSnapshot,
} from '../../../lib/content/validatorReviewSnapshotAssembler';
import {
  buildValidatorCoverageLedger,
  serializeValidatorCoverageLedger,
} from '../../../lib/content/validatorCoverageLedger';
import {
  buildValidatorDecisionTrace,
  serializeValidatorDecisionTrace,
} from '../../../lib/content/validatorDecisionTrace';

function buildTraceabilityInputs() {
  const validatorReviewSequence = {
    version: 'validator-review-sequencer-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallReviewSequenceReadiness: 'ready' as const,
    reviewSequenceOrder: [0],
    reviewDependencyOrdering: ['0. narrative', '1. authority'],
    reviewPriorityOrdering: [0],
    reviewDeferralOrdering: [],
    sectionReviewSequencePlans: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      sequencePosition: 0,
      reviewPriority: 'high' as const,
      dependencySignals: ['0. narrative', '1. authority'],
      boundarySignals: ['preserve section boundary'],
      preservationSignals: ['preserve progression stage: diagnose'],
      deferralSignals: [],
    }],
    reviewSequenceRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    reviewSequenceConfidence: 'high' as const,
  };
  const validatorResultContracts = {
    version: 'validator-result-contracts-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallValidatorResultReadiness: 'ready' as const,
    validatorResultRequirements: ['structured validator result payload'],
    validatorResultBoundaries: ['preserve section boundary'],
    validatorResultVerificationRequirements: ['verify recovery target'],
    validatorResultPreservationRequirements: ['preserve progression stage: diagnose'],
    sectionValidatorResultContracts: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      resultEligibility: 'eligible' as const,
      resultRequirements: ['structured validator result payload'],
      resultBoundaries: ['preserve section boundary'],
      resultVerificationRequirements: ['verify recovery target'],
      resultPreservationRequirements: ['preserve progression stage: diagnose'],
    }],
    validatorResultRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    validatorResultConfidence: 'high' as const,
  };
  const validatorDecisionPreparation = {
    version: 'validator-decision-preparation-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallDecisionPreparationReadiness: 'ready' as const,
    decisionPreparationSignals: ['validator result readiness: ready'],
    decisionDependencySignals: ['0. narrative', '1. authority'],
    decisionBoundarySignals: ['preserve section boundary'],
    decisionPreservationSignals: ['preserve progression stage: diagnose'],
    decisionRiskSignals: [],
    sectionDecisionPreparation: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      decisionEligibility: 'eligible' as const,
      decisionSignals: ['prepare validator decision for section 0'],
      dependencySignals: ['0. narrative', '1. authority'],
      boundarySignals: ['preserve section boundary'],
      preservationSignals: ['preserve progression stage: diagnose'],
      riskSignals: [],
    }],
    decisionPreparationConfidence: 'high' as const,
  };
  const validatorAcceptanceSimulation = {
    version: 'validator-acceptance-simulation-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallAcceptanceSimulationReadiness: 'ready' as const,
    simulatedAcceptanceEligibility: 'acceptable' as const,
    simulatedAcceptanceRisks: [],
    simulatedAcceptanceDeferrals: [],
    simulatedAcceptanceDependencies: ['0. narrative', '1. authority'],
    sectionAcceptanceSimulations: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      simulatedAcceptanceEligibility: 'acceptable' as const,
      simulatedRisks: [],
      simulatedDeferrals: [],
      simulatedDependencies: ['0. narrative', '1. authority'],
      preservationExpectations: ['preserve progression stage: diagnose'],
    }],
    acceptanceSimulationRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    acceptanceSimulationConfidence: 'high' as const,
  };
  const validatorRecoveryDecisionSequence = {
    version: 'validator-recovery-decision-sequencer-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallRecoveryDecisionReadiness: 'ready' as const,
    recoveryDecisionSequence: [0],
    recoveryDependencyOrdering: ['0. narrative', '1. authority'],
    recoveryPriorityOrdering: [0],
    recoveryDeferralOrdering: [],
    sectionRecoveryDecisionPlans: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      recoveryDecisionEligibility: 'acceptable' as const,
      recoveryDecisionPriority: 'high' as const,
      dependencySignals: ['0. narrative', '1. authority'],
      preservationSignals: ['preserve progression stage: diagnose'],
      boundarySignals: ['preserve section boundary'],
      deferralSignals: [],
    }],
    recoveryDecisionRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    recoveryDecisionConfidence: 'high' as const,
  };
  const validatorAuditTrail = buildValidatorAuditTrail({
    validatorRecoveryDecisionSequence,
    validatorAcceptanceSimulation,
    validatorDecisionPreparation,
    validatorResultContracts,
    validatorReviewSequence,
  });
  const validatorReviewSnapshot = assembleValidatorReviewSnapshot({
    validatorAuditTrail,
    validatorRecoveryDecisionSequence,
    validatorAcceptanceSimulation,
    validatorDecisionPreparation,
    validatorResultContracts,
  });
  const validatorCoverageLedger = buildValidatorCoverageLedger({
    validatorReviewSnapshot,
    validatorAuditTrail,
    validatorRecoveryDecisionSequence,
    validatorResultContracts,
  });
  const validatorDecisionTrace = buildValidatorDecisionTrace({
    validatorCoverageLedger,
    validatorReviewSnapshot,
    validatorAuditTrail,
    validatorRecoveryDecisionSequence,
    validatorDecisionPreparation,
  });

  return {
    validatorAuditTrail,
    validatorReviewSnapshot,
    validatorCoverageLedger,
    validatorDecisionTrace,
  };
}

describe('validator audit traceability', () => {
  it('generates validator audit trails', () => {
    const { validatorAuditTrail } = buildTraceabilityInputs();

    expect(validatorAuditTrail.version).toBe('validator-audit-trail-v1');
    expect(validatorAuditTrail.auditEventSequence.join(' ')).toContain('recovery decision readiness');
    expect(validatorAuditTrail.sectionAuditEvents).toHaveLength(1);
  });

  it('generates validator review snapshots', () => {
    const { validatorReviewSnapshot } = buildTraceabilityInputs();

    expect(validatorReviewSnapshot.version).toBe('validator-review-snapshot-v1');
    expect(validatorReviewSnapshot.reviewSnapshots.join(' ')).toContain('result contracts');
    expect(validatorReviewSnapshot.sectionReviewSnapshots).toHaveLength(1);
  });

  it('generates validator coverage ledgers', () => {
    const { validatorCoverageLedger } = buildTraceabilityInputs();

    expect(validatorCoverageLedger.version).toBe('validator-coverage-ledger-v1');
    expect(validatorCoverageLedger.boundaryCoverageLedger.join(' ')).toContain('boundary');
    expect(validatorCoverageLedger.sectionCoverageLedger).toHaveLength(1);
  });

  it('generates validator decision traces', () => {
    const { validatorDecisionTrace } = buildTraceabilityInputs();

    expect(validatorDecisionTrace.version).toBe('validator-decision-trace-v1');
    expect(validatorDecisionTrace.decisionTraceSequence.join(' ')).toContain('decision section');
    expect(validatorDecisionTrace.sectionDecisionTraces).toHaveLength(1);
  });

  it('preserves dependency order and boundary propagation', () => {
    const { validatorCoverageLedger, validatorDecisionTrace } = buildTraceabilityInputs();

    expect(validatorCoverageLedger.dependencyCoverageLedger.join(' ')).toContain('authority');
    expect(validatorDecisionTrace.decisionTraceDependencies.join(' ')).toContain('narrative');
    expect(validatorDecisionTrace.decisionTraceBoundaries.join(' ')).toContain('boundary');
  });

  it('propagates preservation into section traces', () => {
    const { validatorDecisionTrace } = buildTraceabilityInputs();

    expect(validatorDecisionTrace.decisionTracePreservationSignals.join(' ')).toContain('diagnose');
    expect(validatorDecisionTrace.sectionDecisionTraces[0].preservationTrace.join(' ')).toContain('diagnose');
  });

  it('serializes compact traceability outputs', () => {
    const {
      validatorAuditTrail,
      validatorReviewSnapshot,
      validatorCoverageLedger,
      validatorDecisionTrace,
    } = buildTraceabilityInputs();

    expect(serializeValidatorAuditTrail(validatorAuditTrail)).toContain('## VALIDATOR AUDIT TRAIL');
    expect(serializeValidatorReviewSnapshot(validatorReviewSnapshot)).toContain('## VALIDATOR REVIEW SNAPSHOT');
    expect(serializeValidatorCoverageLedger(validatorCoverageLedger)).toContain('## VALIDATOR COVERAGE LEDGER');
    expect(serializeValidatorDecisionTrace(validatorDecisionTrace)).toContain('## VALIDATOR DECISION TRACE');
    expect(serializeValidatorDecisionTrace(validatorDecisionTrace).length).toBeLessThan(2200);
  });
});
