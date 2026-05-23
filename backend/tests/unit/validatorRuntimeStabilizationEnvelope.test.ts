import {
  buildValidatorRuntimeStabilizationEnvelope,
  serializeValidatorRuntimeStabilizationEnvelope,
} from '../../../lib/content/validatorRuntimeStabilizationEnvelope';

function buildStabilizationInput() {
  const validatorRuntimeReadinessEnvelope = {
    version: 'validator-runtime-readiness-envelope-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallRuntimeReadiness: 'runtime_ready' as const,
    runtimeReadinessStatus: 'runtime_ready' as const,
    runtimeReadinessInputs: ['validator runtime eligibility interpretation'],
    runtimeReadinessDependencies: ['0. narrative', '1. authority'],
    runtimeReadinessBoundaries: ['preserve section boundary'],
    runtimeReadinessPreservationRequirements: ['preserve progression stage: diagnose'],
    runtimeReadinessVerificationRequirements: ['runtime readiness envelope is advisory-only'],
    runtimeReadinessRiskSignals: [],
    runtimeReadinessGapSignals: [],
    runtimeReadinessInterpretation: {
      allowedStatuses: ['runtime_ready', 'runtime_conditional', 'runtime_not_ready'] as const,
      defaultStatus: 'runtime_not_ready' as const,
      advisoryOnly: true,
    },
    sectionRuntimeReadiness: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      runtimeReadinessStatus: 'runtime_ready' as const,
      runtimeReadinessDependencies: ['0. narrative', '1. authority'],
      runtimeReadinessBoundaries: ['preserve section boundary'],
      runtimeReadinessPreservationRequirements: ['preserve progression stage: diagnose'],
      runtimeReadinessVerificationRequirements: ['runtime readiness envelope is advisory-only'],
      runtimeReadinessRiskSignals: [],
      runtimeReadinessGapSignals: [],
    }],
    runtimeReadinessConfidence: 'high' as const,
  };
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
  const validatorRuntimeGovernanceEnvelope = {
    version: 'validator-runtime-governance-envelope-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallRuntimeGovernanceReadiness: 'governance_ready' as const,
    runtimeGovernanceStatus: 'governance_ready' as const,
    runtimeGovernanceInputs: ['validator runtime readiness envelope'],
    runtimeGovernanceDependencies: ['0. narrative', '1. authority'],
    runtimeGovernanceBoundaries: ['preserve section boundary'],
    runtimeGovernancePreservationRequirements: ['preserve progression stage: diagnose'],
    runtimeGovernanceVerificationRequirements: ['runtime governance envelope is advisory-only and must not gate runtime behavior'],
    runtimeGovernanceRiskSignals: [],
    runtimeGovernanceGapSignals: [],
    runtimeGovernanceInterpretation: {
      allowedStatuses: ['governance_ready', 'governance_conditional', 'governance_not_ready'] as const,
      defaultStatus: 'governance_not_ready' as const,
      advisoryOnly: true,
    },
    sectionRuntimeGovernance: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      runtimeGovernanceStatus: 'governance_ready' as const,
      runtimeGovernanceDependencies: ['0. narrative', '1. authority'],
      runtimeGovernanceBoundaries: ['preserve section boundary'],
      runtimeGovernancePreservationRequirements: ['preserve progression stage: diagnose'],
      runtimeGovernanceVerificationRequirements: ['runtime governance envelope is advisory-only'],
      runtimeGovernanceRiskSignals: [],
      runtimeGovernanceGapSignals: [],
    }],
    runtimeGovernanceConfidence: 'high' as const,
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
    validatorRuntimeGovernanceEnvelope,
    validatorRuntimeReadinessEnvelope,
    validatorRuntimeEligibilityInterpretation,
    normalizedValidatorOutputEnvelope,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeStabilizationEnvelope', () => {
  it('generates deterministic runtime stabilization envelopes', () => {
    const first = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());
    const second = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-stabilization-envelope-v1');
    expect(first.overallRuntimeStabilizationReadiness).toBe('stabilization_ready');
  });

  it('interprets stabilization_ready, stabilization_conditional, and stabilization_not_ready states', () => {
    const ready = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());
    const conditionalInput = buildStabilizationInput();
    const conditional = buildValidatorRuntimeStabilizationEnvelope({
      ...conditionalInput,
      validatorRuntimeGovernanceEnvelope: {
        ...conditionalInput.validatorRuntimeGovernanceEnvelope,
        runtimeGovernanceStatus: 'governance_conditional',
        overallRuntimeGovernanceReadiness: 'governance_conditional',
      },
    });
    const blockedInput = buildStabilizationInput();
    const blocked = buildValidatorRuntimeStabilizationEnvelope({
      ...blockedInput,
      validatorRuntimeGovernanceEnvelope: {
        ...blockedInput.validatorRuntimeGovernanceEnvelope,
        runtimeGovernanceStatus: 'governance_not_ready',
        overallRuntimeGovernanceReadiness: 'governance_not_ready',
      },
    });

    expect(ready.runtimeStabilizationStatus).toBe('stabilization_ready');
    expect(conditional.runtimeStabilizationStatus).toBe('stabilization_conditional');
    expect(blocked.runtimeStabilizationStatus).toBe('stabilization_not_ready');
  });

  it('generates dependency expectations', () => {
    const envelope = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());

    expect(envelope.runtimeStabilizationDependencies.join(' ')).toContain('authority');
    expect(envelope.sectionRuntimeStabilization[0].runtimeStabilizationDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const envelope = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());

    expect(envelope.runtimeStabilizationBoundaries.join(' ')).toContain('boundary');
    expect(envelope.runtimeStabilizationPreservationRequirements.join(' ')).toContain('diagnose');
    expect(envelope.sectionRuntimeStabilization[0].runtimeStabilizationPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const envelope = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());

    expect(envelope.runtimeStabilizationVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(envelope.sectionRuntimeStabilization[0].runtimeStabilizationVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildStabilizationInput();
    const envelope = buildValidatorRuntimeStabilizationEnvelope({
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

    expect(envelope.runtimeStabilizationRiskSignals.join(' ')).toContain('envelope risk');
    expect(envelope.runtimeStabilizationGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(envelope.sectionRuntimeStabilization[0].runtimeStabilizationStatus).toBe('stabilization_conditional');
  });

  it('packages section runtime stabilization', () => {
    const envelope = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());

    expect(envelope.sectionRuntimeStabilization).toHaveLength(1);
    expect(envelope.sectionRuntimeStabilization[0].runtimeStabilizationStatus).toBe('stabilization_ready');
    expect(envelope.runtimeStabilizationInterpretation.advisoryOnly).toBe(true);
  });

  it('serializes compact runtime stabilization envelopes', () => {
    const envelope = buildValidatorRuntimeStabilizationEnvelope(buildStabilizationInput());
    const serialized = serializeValidatorRuntimeStabilizationEnvelope(envelope);

    expect(serialized).toContain('## VALIDATOR RUNTIME STABILIZATION ENVELOPE');
    expect(serialized).toContain('Runtime stabilization:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
