import { buildAcceptanceReadinessContracts } from '../../../lib/content/acceptanceReadinessContracts';
import { assembleAcceptanceReviewPackage } from '../../../lib/content/acceptanceReviewPackageAssembler';
import { buildValidatorExecutionManifest } from '../../../lib/content/validatorExecutionManifest';
import { observeValidatorReadiness } from '../../../lib/content/validatorReadinessObserver';
import { sequenceValidatorReview } from '../../../lib/content/validatorReviewSequencer';
import {
  buildValidatorResultContracts,
  serializeValidatorResultContracts,
} from '../../../lib/content/validatorResultContracts';
import {
  prepareValidatorDecision,
  serializeValidatorDecisionPreparation,
} from '../../../lib/content/validatorDecisionPreparation';
import {
  simulateValidatorAcceptance,
  serializeValidatorAcceptanceSimulation,
} from '../../../lib/content/validatorAcceptanceSimulation';
import {
  sequenceValidatorRecoveryDecision,
  serializeValidatorRecoveryDecisionSequence,
} from '../../../lib/content/validatorRecoveryDecisionSequencer';

function buildDecisionInputs() {
  const recoveryExecutionDryRun = {
    version: 'recovery-execution-dry-run-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallDryRunReadiness: 'ready' as const,
    dryRunExecutionOrder: [0, 1],
    dryRunRecoveryTargets: ['restore narrative progression', 'strengthen authority proof'],
    simulatedSafeExecutions: [0, 1],
    simulatedDeferredExecutions: [],
    simulatedConflictRisks: [],
    preservationConflictSignals: ['preserve narrative progression'],
    rewriteDependencySignals: ['0. narrative', '1. authority'],
    narrativeStabilitySignals: ['preserve progression stage: diagnose'],
    authorityStabilitySignals: ['verify no unsupported evidence was introduced'],
    antiRepetitionStabilitySignals: ['verify section responsibility remains distinct'],
    sectionDryRunPlans: [],
    dryRunRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      conflicts: 0,
      deferred: 0,
    },
    dryRunConfidence: 'high' as const,
  };
  const recoveryExecutorContracts = {
    version: 'recovery-executor-contracts-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallExecutorReadiness: 'ready' as const,
    executorEligibility: 'eligible' as const,
    executorInputRequirements: ['original generated content'],
    executorOutputRequirements: ['structured recovered section outputs'],
    executorPreservationRequirements: ['preserve narrative progression'],
    executorBoundaryRequirements: ['preserve section boundary'],
    executorDependencyRequirements: ['0. narrative', '1. authority'],
    executorVerificationRequirements: ['verify preservation requirements before accepting recovered output'],
    executorRecoveryTargets: ['restore narrative progression'],
    executorExecutionSequence: [0, 1],
    executorDeferredTargets: [],
    sectionExecutorContracts: [],
    executorRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      conflicts: 0,
      deferred: 0,
    },
    executorConfidence: 'high' as const,
  };
  const executorVerificationContracts = {
    version: 'executor-verification-contracts-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallVerificationReadiness: 'ready' as const,
    verificationEligibility: 'eligible' as const,
    verificationInputRequirements: ['executor output package'],
    verificationOutputRequirements: ['structured verification report'],
    verificationPreservationChecks: ['preserve narrative progression'],
    verificationBoundaryChecks: ['preserve section boundary'],
    verificationDependencyChecks: ['0. narrative', '1. authority'],
    verificationNarrativeChecks: ['preserve progression stage: diagnose'],
    verificationAuthorityChecks: ['verify no unsupported evidence was introduced'],
    verificationAntiRepetitionChecks: ['verify section responsibility remains distinct'],
    verificationRecoveryChecks: ['verify recovery target: restore narrative progression'],
    sectionVerificationContracts: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      verificationEligibility: 'eligible' as const,
      verificationInputRequirements: ['executor output'],
      verificationOutputRequirements: ['verification report'],
      preservationChecks: ['preserve progression stage: diagnose'],
      boundaryChecks: ['preserve section boundary'],
      dependencyChecks: ['execution order index: 0'],
      narrativeChecks: ['preserve progression stage: diagnose'],
      authorityChecks: ['verify evidence'],
      antiRepetitionChecks: ['verify distinct section responsibility'],
      recoveryChecks: ['verify recovery target'],
    }],
    verificationRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      conflicts: 0,
      deferred: 0,
    },
    verificationConfidence: 'high' as const,
  };
  const verificationReadinessObservation = {
    version: 'verification-readiness-observer-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallVerificationCoverage: 'sufficient' as const,
    verificationCoverageStatus: 'sufficient' as const,
    verificationCompletenessSignals: ['input requirements: 1', 'output requirements: 1'],
    preservationCoverageSignals: ['preserve narrative progression'],
    boundaryCoverageSignals: ['preserve section boundary'],
    dependencyCoverageSignals: ['execution order index: 0'],
    narrativeCoverageSignals: ['preserve progression stage: diagnose'],
    authorityCoverageSignals: ['verify evidence'],
    antiRepetitionCoverageSignals: ['verify distinct section responsibility'],
    recoveryCoverageSignals: ['verify recovery target'],
    sectionVerificationCoverage: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      coverageStatus: 'sufficient' as const,
      preservationCoverage: true,
      boundaryCoverage: true,
      dependencyCoverage: true,
      narrativeCoverage: true,
      authorityCoverage: true,
      antiRepetitionCoverage: true,
      recoveryCoverage: true,
      coverageGaps: [],
    }],
    verificationGapSignals: [],
    verificationCoverageConfidence: 'high' as const,
  };
  const acceptanceReadinessContracts = buildAcceptanceReadinessContracts({
    verificationReadinessObservation,
    executorVerificationContracts,
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
  });
  const acceptanceReviewPackage = assembleAcceptanceReviewPackage({
    acceptanceReadinessContracts,
    verificationReadinessObservation,
    executorVerificationContracts,
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
  });
  const validatorReadinessObservation = observeValidatorReadiness({
    acceptanceReviewPackage,
    acceptanceReadinessContracts,
    verificationReadinessObservation,
    executorVerificationContracts,
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
  });
  const validatorExecutionManifest = buildValidatorExecutionManifest({
    acceptanceReviewPackage,
    validatorReadinessObservation,
    acceptanceReadinessContracts,
    verificationReadinessObservation,
    executorVerificationContracts,
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
  });
  const validatorReviewSequence = sequenceValidatorReview({
    validatorExecutionManifest,
    validatorReadinessObservation,
    acceptanceReviewPackage,
    acceptanceReadinessContracts,
    recoveryExecutionDryRun,
  });
  const validatorResultContracts = buildValidatorResultContracts({
    validatorReviewSequence,
    validatorExecutionManifest,
    validatorReadinessObservation,
    acceptanceReviewPackage,
    executorVerificationContracts,
  });
  const validatorDecisionPreparation = prepareValidatorDecision({
    validatorResultContracts,
    validatorReviewSequence,
    validatorExecutionManifest,
    validatorReadinessObservation,
    acceptanceReviewPackage,
  });
  const validatorAcceptanceSimulation = simulateValidatorAcceptance({
    validatorDecisionPreparation,
    validatorResultContracts,
    validatorReviewSequence,
  });
  const validatorRecoveryDecisionSequence = sequenceValidatorRecoveryDecision({
    validatorAcceptanceSimulation,
    validatorDecisionPreparation,
    validatorResultContracts,
    validatorReviewSequence,
    validatorExecutionManifest,
  });

  return {
    validatorReviewSequence,
    validatorExecutionManifest,
    validatorResultContracts,
    validatorDecisionPreparation,
    validatorAcceptanceSimulation,
    validatorRecoveryDecisionSequence,
  };
}

describe('validator decision orchestration', () => {
  it('generates validator result contracts', () => {
    const { validatorResultContracts } = buildDecisionInputs();

    expect(validatorResultContracts.version).toBe('validator-result-contracts-v1');
    expect(validatorResultContracts.sectionValidatorResultContracts).toHaveLength(1);
    expect(validatorResultContracts.validatorResultBoundaries.join(' ')).toContain('boundary');
  });

  it('generates decision preparation', () => {
    const { validatorDecisionPreparation } = buildDecisionInputs();

    expect(validatorDecisionPreparation.version).toBe('validator-decision-preparation-v1');
    expect(validatorDecisionPreparation.sectionDecisionPreparation).toHaveLength(1);
    expect(validatorDecisionPreparation.decisionPreparationSignals.join(' ')).toContain('readiness');
  });

  it('generates acceptance simulation', () => {
    const { validatorAcceptanceSimulation } = buildDecisionInputs();

    expect(validatorAcceptanceSimulation.version).toBe('validator-acceptance-simulation-v1');
    expect(validatorAcceptanceSimulation.simulatedAcceptanceEligibility).toBe('acceptable');
    expect(validatorAcceptanceSimulation.sectionAcceptanceSimulations).toHaveLength(1);
  });

  it('generates recovery decision sequencing', () => {
    const { validatorRecoveryDecisionSequence } = buildDecisionInputs();

    expect(validatorRecoveryDecisionSequence.version).toBe('validator-recovery-decision-sequencer-v1');
    expect(validatorRecoveryDecisionSequence.recoveryDecisionSequence).toEqual([0]);
    expect(validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans).toHaveLength(1);
  });

  it('preserves dependency order and boundary propagation', () => {
    const {
      validatorDecisionPreparation,
      validatorRecoveryDecisionSequence,
    } = buildDecisionInputs();

    expect(validatorDecisionPreparation.decisionDependencySignals.join(' ')).toContain('authority');
    expect(validatorDecisionPreparation.decisionBoundarySignals.join(' ')).toContain('boundary');
    expect(validatorRecoveryDecisionSequence.recoveryDependencyOrdering.join(' ')).toContain('narrative');
  });

  it('propagates preservation into section decision packaging', () => {
    const {
      validatorDecisionPreparation,
      validatorRecoveryDecisionSequence,
    } = buildDecisionInputs();

    expect(validatorDecisionPreparation.decisionPreservationSignals.join(' ')).toContain('narrative');
    expect(validatorRecoveryDecisionSequence.sectionRecoveryDecisionPlans[0].preservationSignals.join(' ')).toContain('diagnose');
  });

  it('serializes compact decision orchestration outputs', () => {
    const {
      validatorResultContracts,
      validatorDecisionPreparation,
      validatorAcceptanceSimulation,
      validatorRecoveryDecisionSequence,
    } = buildDecisionInputs();

    expect(serializeValidatorResultContracts(validatorResultContracts)).toContain('## VALIDATOR RESULT CONTRACTS');
    expect(serializeValidatorDecisionPreparation(validatorDecisionPreparation)).toContain('## VALIDATOR DECISION PREPARATION');
    expect(serializeValidatorAcceptanceSimulation(validatorAcceptanceSimulation)).toContain('## VALIDATOR ACCEPTANCE SIMULATION');
    expect(serializeValidatorRecoveryDecisionSequence(validatorRecoveryDecisionSequence)).toContain('## VALIDATOR RECOVERY DECISION SEQUENCE');
    expect(serializeValidatorRecoveryDecisionSequence(validatorRecoveryDecisionSequence).length).toBeLessThan(2200);
  });
});
