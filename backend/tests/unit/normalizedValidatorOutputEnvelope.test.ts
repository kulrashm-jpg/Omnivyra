import {
  buildNormalizedValidatorOutputEnvelope,
  serializeNormalizedValidatorOutputEnvelope,
} from '../../../lib/content/normalizedValidatorOutputEnvelope';

function buildEnvelopeInput() {
  const validatorOutputNormalizationContract = {
    version: 'validator-output-normalization-contract-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallNormalizationReadiness: 'ready' as const,
    normalizationEligibility: 'eligible' as const,
    normalizationInputs: ['validator invocation result contract'],
    normalizationOutputs: ['normalized validator result package'],
    normalizationDependencies: ['0. narrative', '1. authority'],
    normalizationBoundaries: ['preserve section boundary'],
    normalizationPreservationRequirements: ['preserve progression stage: diagnose'],
    normalizationVerificationRequirements: ['validator output normalization remains advisory-only'],
    normalizationRiskSignals: [],
    normalizationGapSignals: [],
    sectionNormalizationContracts: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      normalizationEligibility: 'eligible' as const,
      normalizationInputs: ['section invocation result contract'],
      normalizationOutputs: ['normalized validator section status'],
      normalizationDependencies: ['0. narrative', '1. authority'],
      normalizationBoundaries: ['preserve section boundary'],
      normalizationPreservationRequirements: ['preserve progression stage: diagnose'],
      normalizationVerificationRequirements: ['normalize validator status into pass, fail, or needs_review'],
      normalizationRiskSignals: [],
      normalizationGapSignals: [],
    }],
    normalizationConfidence: 'high' as const,
  };
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
    sectionInvocationResults: [],
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
    validatorOutputNormalizationContract,
    validatorInvocationResultContract,
    validatorInvocationDryRunPlan,
    validatorExecutionAdapterContract,
    validatorDecisionTrace,
  };
}

describe('normalizedValidatorOutputEnvelope', () => {
  it('generates deterministic normalized envelopes', () => {
    const first = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());
    const second = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('normalized-validator-output-envelope-v1');
    expect(first.overallNormalizedEnvelopeReadiness).toBe('ready');
  });

  it('generates a stable status model', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(envelope.normalizedEnvelopeStatusModel.allowedStatuses).toEqual(['pass', 'fail', 'needs_review', 'not_evaluated']);
    expect(envelope.normalizedEnvelopeStatusModel.advisoryOnly).toBe(true);
  });

  it('generates dependency expectations', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(envelope.normalizedEnvelopeDependencies.join(' ')).toContain('authority');
    expect(envelope.sectionNormalizedEnvelopes[0].envelopeDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(envelope.normalizedEnvelopeBoundaries.join(' ')).toContain('boundary');
    expect(envelope.normalizedEnvelopePreservationRequirements.join(' ')).toContain('diagnose');
    expect(envelope.sectionNormalizedEnvelopes[0].envelopePreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(envelope.normalizedEnvelopeVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(envelope.sectionNormalizedEnvelopes[0].envelopeVerificationRequirements.join(' ')).toContain('needs_review');
  });

  it('generates risk and gap signals', () => {
    const input = buildEnvelopeInput();
    const envelope = buildNormalizedValidatorOutputEnvelope({
      ...input,
      validatorOutputNormalizationContract: {
        ...input.validatorOutputNormalizationContract,
        overallNormalizationReadiness: 'conditional',
        normalizationEligibility: 'deferred',
        normalizationRiskSignals: ['normalization risk'],
        normalizationGapSignals: ['missing normalization boundary'],
        sectionNormalizationContracts: [{
          ...input.validatorOutputNormalizationContract.sectionNormalizationContracts[0],
          normalizationEligibility: 'deferred',
          normalizationRiskSignals: ['section normalization risk'],
          normalizationGapSignals: ['missing section normalization source'],
        }],
      },
    });

    expect(envelope.overallNormalizedEnvelopeReadiness).toBe('conditional');
    expect(envelope.normalizedEnvelopeRiskSignals.join(' ')).toContain('normalization risk');
    expect(envelope.normalizedEnvelopeGapSignals.join(' ')).toContain('missing normalization boundary');
    expect(envelope.sectionNormalizedEnvelopes[0].normalizedStatus).toBe('needs_review');
  });

  it('packages section normalized envelopes', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());

    expect(envelope.sectionNormalizedEnvelopes).toHaveLength(1);
    expect(envelope.sectionNormalizedEnvelopes[0].normalizedStatus).toBe('pass');
    expect(envelope.sectionNormalizedEnvelopes[0].envelopeOutputs.join(' ')).toContain('normalized');
  });

  it('serializes compact normalized envelopes', () => {
    const envelope = buildNormalizedValidatorOutputEnvelope(buildEnvelopeInput());
    const serialized = serializeNormalizedValidatorOutputEnvelope(envelope);

    expect(serialized).toContain('## NORMALIZED VALIDATOR OUTPUT ENVELOPE');
    expect(serialized).toContain('Envelope readiness:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
