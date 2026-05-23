import {
  buildValidatorOutputNormalizationContract,
  serializeValidatorOutputNormalizationContract,
} from '../../../lib/content/validatorOutputNormalizationContract';

function buildNormalizationInput() {
  const validatorInvocationResultContract = {
    version: 'validator-invocation-result-contract-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallInvocationResultReadiness: 'ready' as const,
    invocationResultEligibility: 'eligible' as const,
    invocationResultInputs: ['validator invocation dry-run plan'],
    invocationResultOutputs: ['future validator invocation result package'],
    invocationResultDependencies: ['0. narrative', '1. authority'],
    invocationResultBoundaries: ['preserve section boundary'],
    invocationResultPreservationRequirements: ['preserve progression stage: diagnose'],
    invocationResultVerificationRequirements: ['future validator invocation output must be advisory-only until enforcement is separately implemented'],
    invocationResultRiskSignals: [],
    invocationResultGapSignals: [],
    sectionInvocationResults: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      invocationResultEligibility: 'eligible' as const,
      resultInputs: ['section invocation dry-run output'],
      resultOutputs: ['future validator result status'],
      resultDependencies: ['0. narrative', '1. authority'],
      resultBoundaries: ['preserve section boundary'],
      resultPreservationRequirements: ['preserve progression stage: diagnose'],
      resultVerificationRequirements: ['future validator result must state pass/fail/needs_review without enforcing'],
      resultRiskSignals: [],
      resultGapSignals: [],
    }],
    invocationResultConfidence: 'high' as const,
  };
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
    sectionInvocationDryRuns: [],
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
    sectionExecutionAdapters: [],
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
    validatorInvocationResultContract,
    validatorInvocationDryRunPlan,
    validatorExecutionAdapterContract,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorOutputNormalizationContract', () => {
  it('generates deterministic normalization contracts', () => {
    const first = buildValidatorOutputNormalizationContract(buildNormalizationInput());
    const second = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-output-normalization-contract-v1');
    expect(first.overallNormalizationReadiness).toBe('ready');
  });

  it('generates input and output normalization expectations', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(contract.normalizationInputs.join(' ')).toContain('invocation result');
    expect(contract.normalizationOutputs.join(' ')).toContain('normalized validator');
  });

  it('generates dependency expectations', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(contract.normalizationDependencies.join(' ')).toContain('authority');
    expect(contract.sectionNormalizationContracts[0].normalizationDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(contract.normalizationBoundaries.join(' ')).toContain('boundary');
    expect(contract.normalizationPreservationRequirements.join(' ')).toContain('diagnose');
    expect(contract.sectionNormalizationContracts[0].normalizationPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification normalization expectations', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(contract.normalizationVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(contract.sectionNormalizationContracts[0].normalizationVerificationRequirements.join(' ')).toContain('pass, fail, or needs_review');
  });

  it('generates gap signals from invocation result gaps', () => {
    const input = buildNormalizationInput();
    const contract = buildValidatorOutputNormalizationContract({
      ...input,
      validatorInvocationResultContract: {
        ...input.validatorInvocationResultContract,
        overallInvocationResultReadiness: 'conditional',
        invocationResultEligibility: 'deferred',
        invocationResultGapSignals: ['missing invocation boundary simulation'],
        sectionInvocationResults: [{
          ...input.validatorInvocationResultContract.sectionInvocationResults[0],
          invocationResultEligibility: 'deferred',
          resultGapSignals: ['missing section normalization source'],
        }],
      },
    });

    expect(contract.overallNormalizationReadiness).toBe('conditional');
    expect(contract.normalizationGapSignals.join(' ')).toContain('missing invocation boundary simulation');
    expect(contract.sectionNormalizationContracts[0].normalizationGapSignals.join(' ')).toContain('missing section normalization source');
  });

  it('packages section normalization contracts', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());

    expect(contract.sectionNormalizationContracts).toHaveLength(1);
    expect(contract.sectionNormalizationContracts[0].normalizationEligibility).toBe('eligible');
    expect(contract.sectionNormalizationContracts[0].normalizationOutputs.join(' ')).toContain('normalized validator');
  });

  it('serializes compact normalization contracts', () => {
    const contract = buildValidatorOutputNormalizationContract(buildNormalizationInput());
    const serialized = serializeValidatorOutputNormalizationContract(contract);

    expect(serialized).toContain('## VALIDATOR OUTPUT NORMALIZATION CONTRACT');
    expect(serialized).toContain('Normalization readiness:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
