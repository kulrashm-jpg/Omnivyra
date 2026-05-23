import { buildAcceptanceReadinessContracts } from '../../../lib/content/acceptanceReadinessContracts';
import {
  assembleAcceptanceReviewPackage,
  serializeAcceptanceReviewPackage,
} from '../../../lib/content/acceptanceReviewPackageAssembler';
import {
  observeValidatorReadiness,
  serializeValidatorReadinessObservation,
} from '../../../lib/content/validatorReadinessObserver';
import {
  buildValidatorExecutionManifest,
  serializeValidatorExecutionManifest,
} from '../../../lib/content/validatorExecutionManifest';
import {
  sequenceValidatorReview,
  serializeValidatorReviewSequence,
} from '../../../lib/content/validatorReviewSequencer';

function buildOrchestrationInputs() {
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

  return {
    recoveryExecutionDryRun,
    recoveryExecutorContracts,
    executorVerificationContracts,
    verificationReadinessObservation,
    acceptanceReadinessContracts,
    acceptanceReviewPackage,
    validatorReadinessObservation,
    validatorExecutionManifest,
  };
}

describe('validator review orchestration', () => {
  it('generates acceptance review packages', () => {
    const { acceptanceReviewPackage } = buildOrchestrationInputs();

    expect(acceptanceReviewPackage.version).toBe('acceptance-review-package-v1');
    expect(acceptanceReviewPackage.acceptanceReviewPayload.inputs.join(' ')).toContain('verification');
    expect(acceptanceReviewPackage.sectionAcceptanceReviewPayloads).toHaveLength(1);
  });

  it('observes validator readiness', () => {
    const { validatorReadinessObservation } = buildOrchestrationInputs();

    expect(validatorReadinessObservation.version).toBe('validator-readiness-observer-v1');
    expect(validatorReadinessObservation.overallValidatorReadiness).toBe('ready');
    expect(validatorReadinessObservation.validatorCoverageSignals.join(' ')).toContain('acceptance review payloads');
  });

  it('packages validator execution manifests', () => {
    const { validatorExecutionManifest } = buildOrchestrationInputs();

    expect(validatorExecutionManifest.version).toBe('validator-execution-manifest-v1');
    expect(validatorExecutionManifest.validatorExecutionTargets).toEqual([0]);
    expect(validatorExecutionManifest.sectionValidatorExecutionPayloads[0].executionBoundaries.join(' ')).toContain('boundary');
  });

  it('generates validator review sequencing', () => {
    const input = buildOrchestrationInputs();
    const sequence = sequenceValidatorReview({
      validatorExecutionManifest: input.validatorExecutionManifest,
      validatorReadinessObservation: input.validatorReadinessObservation,
      acceptanceReviewPackage: input.acceptanceReviewPackage,
      acceptanceReadinessContracts: input.acceptanceReadinessContracts,
      recoveryExecutionDryRun: input.recoveryExecutionDryRun,
    });

    expect(sequence.version).toBe('validator-review-sequencer-v1');
    expect(sequence.reviewSequenceOrder).toEqual([0]);
    expect(sequence.sectionReviewSequencePlans).toHaveLength(1);
  });

  it('preserves dependency ordering and boundary propagation', () => {
    const input = buildOrchestrationInputs();
    const sequence = sequenceValidatorReview({
      validatorExecutionManifest: input.validatorExecutionManifest,
      validatorReadinessObservation: input.validatorReadinessObservation,
      acceptanceReviewPackage: input.acceptanceReviewPackage,
      acceptanceReadinessContracts: input.acceptanceReadinessContracts,
      recoveryExecutionDryRun: input.recoveryExecutionDryRun,
    });

    expect(input.validatorExecutionManifest.validatorExecutionBoundaries.join(' ')).toContain('boundary');
    expect(input.validatorExecutionManifest.validatorExecutionConstraints.join(' ')).toContain('narrative');
    expect(sequence.reviewDependencyOrdering.join(' ')).toContain('authority');
  });

  it('propagates preservation requirements into section review packaging', () => {
    const input = buildOrchestrationInputs();
    const sequence = sequenceValidatorReview({
      validatorExecutionManifest: input.validatorExecutionManifest,
      validatorReadinessObservation: input.validatorReadinessObservation,
      acceptanceReviewPackage: input.acceptanceReviewPackage,
      acceptanceReadinessContracts: input.acceptanceReadinessContracts,
      recoveryExecutionDryRun: input.recoveryExecutionDryRun,
    });

    expect(input.acceptanceReviewPackage.reviewPreservationRequirements.join(' ')).toContain('narrative');
    expect(sequence.sectionReviewSequencePlans[0].preservationSignals.join(' ')).toContain('diagnose');
  });

  it('serializes compact orchestration outputs', () => {
    const input = buildOrchestrationInputs();
    const sequence = sequenceValidatorReview({
      validatorExecutionManifest: input.validatorExecutionManifest,
      validatorReadinessObservation: input.validatorReadinessObservation,
      acceptanceReviewPackage: input.acceptanceReviewPackage,
      acceptanceReadinessContracts: input.acceptanceReadinessContracts,
      recoveryExecutionDryRun: input.recoveryExecutionDryRun,
    });

    expect(serializeAcceptanceReviewPackage(input.acceptanceReviewPackage)).toContain('## ACCEPTANCE REVIEW PACKAGE');
    expect(serializeValidatorReadinessObservation(input.validatorReadinessObservation)).toContain('## VALIDATOR READINESS OBSERVATION');
    expect(serializeValidatorExecutionManifest(input.validatorExecutionManifest)).toContain('## VALIDATOR EXECUTION MANIFEST');
    expect(serializeValidatorReviewSequence(sequence)).toContain('## VALIDATOR REVIEW SEQUENCE');
    expect(serializeValidatorReviewSequence(sequence).length).toBeLessThan(2200);
  });
});
