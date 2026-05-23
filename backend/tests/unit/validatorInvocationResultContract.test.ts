import {
  buildValidatorInvocationResultContract,
  serializeValidatorInvocationResultContract,
} from '../../../lib/content/validatorInvocationResultContract';

function buildResultInput() {
  const validatorInvocationDryRunPlan = {
    version: 'validator-invocation-dry-run-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallInvocationDryRunReadiness: 'ready' as const,
    invocationDryRunEligibility: 'eligible' as const,
    invocationDryRunSequence: [0],
    invocationDependencySimulation: ['0. narrative', '1. authority'],
    invocationBoundarySimulation: ['preserve section boundary'],
    invocationPreservationSimulation: ['preserve progression stage: diagnose'],
    invocationExecutionSimulation: ['dry-run only: do not invoke validators'],
    invocationRiskSimulation: [],
    invocationGapSignals: [],
    sectionInvocationDryRuns: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      invocationReadiness: 'ready' as const,
      invocationEligibility: 'eligible' as const,
      invocationSequencePosition: 0,
      dependencySimulation: ['0. narrative', '1. authority'],
      boundarySimulation: ['preserve section boundary'],
      preservationSimulation: ['preserve progression stage: diagnose'],
      executionSimulation: ['simulate adapter handoff without validator execution'],
      riskSimulation: [],
      gapSignals: [],
    }],
    invocationDryRunConfidence: 'high' as const,
  };
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
    validatorInvocationDryRunPlan,
    validatorExecutionAdapterContract,
    validatorPreflightReadinessGate,
    validatorOperationalReadiness,
    validatorDecisionTrace,
  };
}

describe('validatorInvocationResultContract', () => {
  it('generates deterministic invocation-result contracts', () => {
    const first = buildValidatorInvocationResultContract(buildResultInput());
    const second = buildValidatorInvocationResultContract(buildResultInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-invocation-result-contract-v1');
    expect(first.overallInvocationResultReadiness).toBe('ready');
  });

  it('generates input and output expectations', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());

    expect(contract.invocationResultInputs.join(' ')).toContain('dry-run');
    expect(contract.invocationResultOutputs.join(' ')).toContain('result package');
  });

  it('generates dependency expectations', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());

    expect(contract.invocationResultDependencies.join(' ')).toContain('authority');
    expect(contract.sectionInvocationResults[0].resultDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());

    expect(contract.invocationResultBoundaries.join(' ')).toContain('boundary');
    expect(contract.invocationResultPreservationRequirements.join(' ')).toContain('diagnose');
    expect(contract.sectionInvocationResults[0].resultPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());

    expect(contract.invocationResultVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(contract.sectionInvocationResults[0].resultVerificationRequirements.join(' ')).toContain('pass/fail/needs_review');
  });

  it('generates gap signals from invocation gaps', () => {
    const input = buildResultInput();
    const contract = buildValidatorInvocationResultContract({
      ...input,
      validatorInvocationDryRunPlan: {
        ...input.validatorInvocationDryRunPlan,
        overallInvocationDryRunReadiness: 'conditional',
        invocationDryRunEligibility: 'deferred',
        invocationGapSignals: ['missing adapter boundary expectations'],
        sectionInvocationDryRuns: [{
          ...input.validatorInvocationDryRunPlan.sectionInvocationDryRuns[0],
          invocationReadiness: 'conditional',
          invocationEligibility: 'deferred',
          gapSignals: ['missing invocation boundary simulation'],
        }],
      },
    });

    expect(contract.overallInvocationResultReadiness).toBe('conditional');
    expect(contract.invocationResultGapSignals.join(' ')).toContain('missing adapter boundary expectations');
    expect(contract.sectionInvocationResults[0].resultGapSignals.join(' ')).toContain('missing invocation boundary simulation');
  });

  it('packages section invocation results', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());

    expect(contract.sectionInvocationResults).toHaveLength(1);
    expect(contract.sectionInvocationResults[0].invocationResultEligibility).toBe('eligible');
    expect(contract.sectionInvocationResults[0].resultOutputs.join(' ')).toContain('validator');
  });

  it('serializes compact invocation-result contracts', () => {
    const contract = buildValidatorInvocationResultContract(buildResultInput());
    const serialized = serializeValidatorInvocationResultContract(contract);

    expect(serialized).toContain('## VALIDATOR INVOCATION RESULT CONTRACT');
    expect(serialized).toContain('Invocation result readiness:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
