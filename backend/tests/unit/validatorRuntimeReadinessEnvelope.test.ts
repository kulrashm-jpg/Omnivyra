import {
  buildValidatorRuntimeReadinessEnvelope,
  serializeValidatorRuntimeReadinessEnvelope,
} from '../../../lib/content/validatorRuntimeReadinessEnvelope';

function buildReadinessInput() {
  const validatorRuntimeEligibilityInterpretation = {
    version: 'validator-runtime-eligibility-interpreter-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallRuntimeEligibility: 'runtime_ready' as const,
    runtimeEligibilityStatus: 'runtime_ready' as const,
    runtimeEligibilityInputs: ['validator execution eligibility policy'],
    runtimeEligibilityDependencies: ['0. narrative', '1. authority'],
    runtimeEligibilityBoundaries: ['preserve section boundary'],
    runtimeEligibilityPreservationRequirements: ['preserve progression stage: diagnose'],
    runtimeEligibilityVerificationRequirements: ['runtime eligibility is advisory-only and must not gate runtime behavior'],
    runtimeEligibilityRiskSignals: [],
    runtimeEligibilityGapSignals: [],
    runtimeEligibilityPolicyInterpretation: {
      allowedStatuses: ['runtime_ready', 'runtime_conditional', 'runtime_not_ready'] as const,
      defaultStatus: 'runtime_not_ready' as const,
      advisoryOnly: true,
    },
    sectionRuntimeEligibility: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      runtimeEligibilityStatus: 'runtime_ready' as const,
      runtimeEligibilityDependencies: ['0. narrative', '1. authority'],
      runtimeEligibilityBoundaries: ['preserve section boundary'],
      runtimeEligibilityPreservationRequirements: ['preserve progression stage: diagnose'],
      runtimeEligibilityVerificationRequirements: ['runtime eligibility interpretation is advisory-only'],
      runtimeEligibilityRiskSignals: [],
      runtimeEligibilityGapSignals: [],
    }],
    runtimeEligibilityConfidence: 'high' as const,
  };
  const normalizedValidatorOutputEnvelope = {
    version: 'normalized-validator-output-envelope-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallNormalizedEnvelopeReadiness: 'ready' as const,
    normalizedEnvelopeEligibility: 'eligible' as const,
    normalizedEnvelopeInputs: ['validator output normalization contract'],
    normalizedEnvelopeOutputs: ['normalized validator output envelope'],
    normalizedEnvelopeDependencies: ['0. narrative', '1. authority'],
    normalizedEnvelopeBoundaries: ['preserve section boundary'],
    normalizedEnvelopePreservationRequirements: ['preserve progression stage: diagnose'],
    normalizedEnvelopeVerificationRequirements: ['normalized envelope status is advisory-only'],
    normalizedEnvelopeStatusModel: {
      allowedStatuses: ['pass', 'fail', 'needs_review', 'not_evaluated'] as const,
      defaultStatus: 'not_evaluated' as const,
      advisoryOnly: true,
    },
    normalizedEnvelopeRiskSignals: [],
    normalizedEnvelopeGapSignals: [],
    sectionNormalizedEnvelopes: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      normalizedStatus: 'pass' as const,
      envelopeEligibility: 'eligible' as const,
      envelopeInputs: ['section normalization contract'],
      envelopeOutputs: ['section normalized status'],
      envelopeDependencies: ['0. narrative', '1. authority'],
      envelopeBoundaries: ['preserve section boundary'],
      envelopePreservationRequirements: ['preserve progression stage: diagnose'],
      envelopeVerificationRequirements: ['normalized envelope must remain advisory-only'],
      envelopeRiskSignals: [],
      envelopeGapSignals: [],
    }],
    normalizedEnvelopeConfidence: 'high' as const,
  };
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
    sectionNormalizationContracts: [],
    normalizationConfidence: 'high' as const,
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
    validatorRuntimeEligibilityInterpretation,
    normalizedValidatorOutputEnvelope,
    validatorOutputNormalizationContract,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeReadinessEnvelope', () => {
  it('generates deterministic runtime readiness envelopes', () => {
    const first = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());
    const second = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-readiness-envelope-v1');
    expect(first.overallRuntimeReadiness).toBe('runtime_ready');
  });

  it('packages runtime_ready, runtime_conditional, and runtime_not_ready states', () => {
    const ready = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());
    const conditionalInput = buildReadinessInput();
    const conditional = buildValidatorRuntimeReadinessEnvelope({
      ...conditionalInput,
      validatorRuntimeEligibilityInterpretation: {
        ...conditionalInput.validatorRuntimeEligibilityInterpretation,
        runtimeEligibilityStatus: 'runtime_conditional',
        overallRuntimeEligibility: 'runtime_conditional',
        runtimeEligibilityRiskSignals: ['runtime eligibility risk'],
      },
    });
    const blockedInput = buildReadinessInput();
    const blocked = buildValidatorRuntimeReadinessEnvelope({
      ...blockedInput,
      normalizedValidatorOutputEnvelope: {
        ...blockedInput.normalizedValidatorOutputEnvelope,
        overallNormalizedEnvelopeReadiness: 'blocked',
      },
    });

    expect(ready.runtimeReadinessStatus).toBe('runtime_ready');
    expect(conditional.runtimeReadinessStatus).toBe('runtime_conditional');
    expect(blocked.runtimeReadinessStatus).toBe('runtime_not_ready');
  });

  it('generates dependency expectations', () => {
    const envelope = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());

    expect(envelope.runtimeReadinessDependencies.join(' ')).toContain('authority');
    expect(envelope.sectionRuntimeReadiness[0].runtimeReadinessDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const envelope = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());

    expect(envelope.runtimeReadinessBoundaries.join(' ')).toContain('boundary');
    expect(envelope.runtimeReadinessPreservationRequirements.join(' ')).toContain('diagnose');
    expect(envelope.sectionRuntimeReadiness[0].runtimeReadinessPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const envelope = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());

    expect(envelope.runtimeReadinessVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(envelope.sectionRuntimeReadiness[0].runtimeReadinessVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildReadinessInput();
    const envelope = buildValidatorRuntimeReadinessEnvelope({
      ...input,
      normalizedValidatorOutputEnvelope: {
        ...input.normalizedValidatorOutputEnvelope,
        normalizedEnvelopeRiskSignals: ['envelope risk'],
        normalizedEnvelopeGapSignals: ['missing envelope dependency'],
        sectionNormalizedEnvelopes: [{
          ...input.normalizedValidatorOutputEnvelope.sectionNormalizedEnvelopes[0],
          normalizedStatus: 'needs_review',
          envelopeRiskSignals: ['section risk'],
          envelopeGapSignals: ['section gap'],
        }],
      },
    });

    expect(envelope.runtimeReadinessRiskSignals.join(' ')).toContain('envelope risk');
    expect(envelope.runtimeReadinessGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(envelope.sectionRuntimeReadiness[0].runtimeReadinessStatus).toBe('runtime_conditional');
  });

  it('packages section runtime readiness', () => {
    const envelope = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());

    expect(envelope.sectionRuntimeReadiness).toHaveLength(1);
    expect(envelope.sectionRuntimeReadiness[0].runtimeReadinessStatus).toBe('runtime_ready');
    expect(envelope.runtimeReadinessInterpretation.advisoryOnly).toBe(true);
  });

  it('serializes compact runtime readiness envelopes', () => {
    const envelope = buildValidatorRuntimeReadinessEnvelope(buildReadinessInput());
    const serialized = serializeValidatorRuntimeReadinessEnvelope(envelope);

    expect(serialized).toContain('## VALIDATOR RUNTIME READINESS ENVELOPE');
    expect(serialized).toContain('Runtime readiness:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
