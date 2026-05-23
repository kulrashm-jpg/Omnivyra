import {
  planValidatorInvocationDryRun,
  serializeValidatorInvocationDryRunPlan,
} from '../../../lib/content/validatorInvocationDryRunPlanner';

function buildDryRunInput() {
  const validatorExecutionAdapterContract = {
    version: 'validator-execution-adapter-contract-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallExecutionAdapterReadiness: 'ready' as const,
    executionAdapterEligibility: 'eligible' as const,
    executionAdapterInputs: ['validator preflight readiness gate'],
    executionAdapterOutputs: ['future validator advisory result package'],
    executionAdapterDependencies: ['0. narrative', '1. authority'],
    executionAdapterBoundaries: ['preserve section boundary'],
    executionAdapterPreservationRequirements: ['preserve progression stage: diagnose'],
    executionAdapterExecutionRequirements: ['adapter output is diagnostic-only until validator execution is separately implemented'],
    executionAdapterRiskSignals: [],
    executionAdapterGapSignals: [],
    sectionExecutionAdapters: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      executionAdapterEligibility: 'eligible' as const,
      adapterInputs: ['section execution preparation', 'section preflight readiness'],
      adapterOutputs: ['future validator advisory result'],
      adapterDependencies: ['0. narrative', '1. authority'],
      adapterBoundaries: ['preserve section boundary'],
      adapterPreservationRequirements: ['preserve progression stage: diagnose'],
      adapterExecutionRequirements: ['validator adapter must remain non-executing until explicit runtime executor is implemented'],
      adapterRiskSignals: [],
      adapterGapSignals: [],
    }],
    executionAdapterConfidence: 'high' as const,
  };
  const validatorPreflightReadinessGate = {
    version: 'validator-preflight-readiness-gate-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallPreflightReadiness: 'ready' as const,
    preflightEligibility: 'eligible' as const,
    preflightDependencyCoverage: ['0. narrative', '1. authority'],
    preflightBoundaryCoverage: ['preserve section boundary'],
    preflightPreservationCoverage: ['preserve progression stage: diagnose'],
    preflightExecutionCoverage: ['validator handoff package is non-executing'],
    preflightRiskSignals: [],
    preflightGapSignals: [],
    sectionPreflightReadiness: [],
    preflightConfidence: 'high' as const,
  };
  const validatorOperationalReadiness = {
    version: 'validator-operational-readiness-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallOperationalReadiness: 'ready' as const,
    operationalCoverageSignals: ['handoff readiness: ready'],
    operationalDependencySignals: ['0. narrative', '1. authority'],
    operationalBoundaryCoverage: ['preserve section boundary'],
    operationalPreservationCoverage: ['preserve progression stage: diagnose'],
    operationalGapSignals: [],
    sectionOperationalReadiness: [],
    operationalReadinessConfidence: 'high' as const,
  };
  const validatorExecutionPreparation = {
    version: 'validator-execution-preparation-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallExecutionPreparationReadiness: 'ready' as const,
    executionPreparationSignals: ['handoff readiness: ready', 'validator execution preparation remains non-executing'],
    executionPreparationDependencies: ['0. narrative', '1. authority'],
    executionPreparationBoundaries: ['preserve section boundary'],
    executionPreparationPreservationSignals: ['preserve progression stage: diagnose'],
    executionPreparationRisks: [],
    sectionExecutionPreparation: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      executionPreparationEligibility: 'eligible' as const,
      executionPreparationSignals: ['handoff section 0'],
      dependencies: ['0. narrative', '1. authority'],
      boundaries: ['preserve section boundary'],
      preservationSignals: ['preserve progression stage: diagnose'],
      risks: [],
    }],
    executionPreparationConfidence: 'high' as const,
  };
  const validatorDecisionTrace = {
    version: 'validator-decision-trace-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallDecisionTraceReadiness: 'ready' as const,
    decisionTraceSequence: ['recovery decision readiness: ready', 'decision section: 0'],
    decisionTraceDependencies: ['0. narrative', '1. authority'],
    decisionTraceBoundaries: ['preserve section boundary'],
    decisionTracePreservationSignals: ['preserve progression stage: diagnose'],
    decisionTraceRiskSignals: [],
    sectionDecisionTraces: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      decisionTrace: ['decision priority: high'],
      dependencyTrace: ['0. narrative', '1. authority'],
      boundaryTrace: ['preserve section boundary'],
      preservationTrace: ['preserve progression stage: diagnose'],
      riskTrace: [],
    }],
    decisionTraceConfidence: 'high' as const,
  };

  return {
    validatorExecutionAdapterContract,
    validatorPreflightReadinessGate,
    validatorOperationalReadiness,
    validatorExecutionPreparation,
    validatorDecisionTrace,
  };
}

describe('validatorInvocationDryRunPlanner', () => {
  it('generates deterministic invocation dry-runs', () => {
    const first = planValidatorInvocationDryRun(buildDryRunInput());
    const second = planValidatorInvocationDryRun(buildDryRunInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-invocation-dry-run-v1');
    expect(first.overallInvocationDryRunReadiness).toBe('ready');
  });

  it('simulates dependencies', () => {
    const plan = planValidatorInvocationDryRun(buildDryRunInput());

    expect(plan.invocationDependencySimulation.join(' ')).toContain('authority');
    expect(plan.sectionInvocationDryRuns[0].dependencySimulation.join(' ')).toContain('narrative');
  });

  it('simulates boundary and preservation propagation', () => {
    const plan = planValidatorInvocationDryRun(buildDryRunInput());

    expect(plan.invocationBoundarySimulation.join(' ')).toContain('boundary');
    expect(plan.invocationPreservationSimulation.join(' ')).toContain('diagnose');
    expect(plan.sectionInvocationDryRuns[0].preservationSimulation.join(' ')).toContain('diagnose');
  });

  it('simulates execution preparation without execution', () => {
    const plan = planValidatorInvocationDryRun(buildDryRunInput());

    expect(plan.invocationExecutionSimulation.join(' ')).toContain('do not invoke validators');
    expect(plan.sectionInvocationDryRuns[0].executionSimulation.join(' ')).toContain('simulate adapter handoff');
  });

  it('generates risk and gap signals', () => {
    const input = buildDryRunInput();
    const plan = planValidatorInvocationDryRun({
      ...input,
      validatorExecutionAdapterContract: {
        ...input.validatorExecutionAdapterContract,
        overallExecutionAdapterReadiness: 'conditional',
        executionAdapterEligibility: 'deferred',
        executionAdapterGapSignals: ['missing adapter boundary expectations'],
        sectionExecutionAdapters: [{
          ...input.validatorExecutionAdapterContract.sectionExecutionAdapters[0],
          executionAdapterEligibility: 'deferred',
          adapterGapSignals: ['missing invocation boundary simulation'],
        }],
      },
    });

    expect(plan.overallInvocationDryRunReadiness).toBe('conditional');
    expect(plan.invocationGapSignals.join(' ')).toContain('missing adapter boundary expectations');
    expect(plan.sectionInvocationDryRuns[0].gapSignals.join(' ')).toContain('missing invocation boundary simulation');
  });

  it('packages section invocation dry-runs', () => {
    const plan = planValidatorInvocationDryRun(buildDryRunInput());

    expect(plan.invocationDryRunSequence).toEqual([0]);
    expect(plan.sectionInvocationDryRuns).toHaveLength(1);
    expect(plan.sectionInvocationDryRuns[0].invocationEligibility).toBe('eligible');
  });

  it('serializes compact invocation dry-runs', () => {
    const plan = planValidatorInvocationDryRun(buildDryRunInput());
    const serialized = serializeValidatorInvocationDryRunPlan(plan);

    expect(serialized).toContain('## VALIDATOR INVOCATION DRY RUN');
    expect(serialized).toContain('Invocation readiness:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
