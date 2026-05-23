import {
  buildValidatorRuntimeActivationReadinessGate,
  serializeValidatorRuntimeActivationReadinessGate,
} from '../../../lib/content/validatorRuntimeActivationReadinessGate';

function buildActivationInput() {
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
  const validatorRuntimeStabilizationEnvelope = {
    version: 'validator-runtime-stabilization-envelope-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallRuntimeStabilizationReadiness: 'stabilization_ready' as const,
    runtimeStabilizationStatus: 'stabilization_ready' as const,
    runtimeStabilizationInputs: ['validator runtime governance envelope'],
    runtimeStabilizationDependencies: ['0. narrative', '1. authority'],
    runtimeStabilizationBoundaries: ['preserve section boundary'],
    runtimeStabilizationPreservationRequirements: ['preserve progression stage: diagnose'],
    runtimeStabilizationVerificationRequirements: ['runtime stabilization envelope is advisory-only and must not gate runtime behavior'],
    runtimeStabilizationRiskSignals: [],
    runtimeStabilizationGapSignals: [],
    runtimeStabilizationInterpretation: {
      allowedStatuses: ['stabilization_ready', 'stabilization_conditional', 'stabilization_not_ready'] as const,
      defaultStatus: 'stabilization_not_ready' as const,
      advisoryOnly: true,
    },
    sectionRuntimeStabilization: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      runtimeStabilizationStatus: 'stabilization_ready' as const,
      runtimeStabilizationDependencies: ['0. narrative', '1. authority'],
      runtimeStabilizationBoundaries: ['preserve section boundary'],
      runtimeStabilizationPreservationRequirements: ['preserve progression stage: diagnose'],
      runtimeStabilizationVerificationRequirements: ['runtime stabilization envelope is advisory-only'],
      runtimeStabilizationRiskSignals: [],
      runtimeStabilizationGapSignals: [],
    }],
    runtimeStabilizationConfidence: 'high' as const,
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
    validatorRuntimeStabilizationEnvelope,
    validatorRuntimeGovernanceEnvelope,
    validatorRuntimeReadinessEnvelope,
    validatorRuntimeEligibilityInterpretation,
    normalizedValidatorOutputEnvelope,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeActivationReadinessGate', () => {
  it('generates deterministic runtime activation readiness gates', () => {
    const first = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());
    const second = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-activation-readiness-gate-v1');
    expect(first.overallRuntimeActivationReadiness).toBe('activation_ready');
  });

  it('interprets activation_ready, activation_hold, and activation_withhold states', () => {
    const ready = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());
    const holdInput = buildActivationInput();
    const hold = buildValidatorRuntimeActivationReadinessGate({
      ...holdInput,
      validatorRuntimeStabilizationEnvelope: {
        ...holdInput.validatorRuntimeStabilizationEnvelope,
        runtimeStabilizationStatus: 'stabilization_conditional',
        overallRuntimeStabilizationReadiness: 'stabilization_conditional',
      },
    });
    const withholdInput = buildActivationInput();
    const withhold = buildValidatorRuntimeActivationReadinessGate({
      ...withholdInput,
      validatorRuntimeStabilizationEnvelope: {
        ...withholdInput.validatorRuntimeStabilizationEnvelope,
        runtimeStabilizationStatus: 'stabilization_not_ready',
        overallRuntimeStabilizationReadiness: 'stabilization_not_ready',
      },
    });

    expect(ready.runtimeActivationStatus).toBe('activation_ready');
    expect(hold.runtimeActivationStatus).toBe('activation_hold');
    expect(withhold.runtimeActivationStatus).toBe('activation_withhold');
  });

  it('generates activate, hold, and withhold recommendations', () => {
    const ready = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());
    const holdInput = buildActivationInput();
    const hold = buildValidatorRuntimeActivationReadinessGate({
      ...holdInput,
      validatorRuntimeGovernanceEnvelope: {
        ...holdInput.validatorRuntimeGovernanceEnvelope,
        runtimeGovernanceStatus: 'governance_conditional',
        overallRuntimeGovernanceReadiness: 'governance_conditional',
      },
    });
    const withholdInput = buildActivationInput();
    const withhold = buildValidatorRuntimeActivationReadinessGate({
      ...withholdInput,
      validatorRuntimeReadinessEnvelope: {
        ...withholdInput.validatorRuntimeReadinessEnvelope,
        runtimeReadinessStatus: 'runtime_not_ready',
        overallRuntimeReadiness: 'runtime_not_ready',
      },
    });

    expect(ready.runtimeActivationRecommendation).toBe('activate');
    expect(hold.runtimeActivationRecommendation).toBe('hold');
    expect(withhold.runtimeActivationRecommendation).toBe('withhold');
    expect(ready.sectionRuntimeActivationReadiness[0].runtimeActivationRecommendation).toBe('activate');
    expect(ready.runtimeActivationInterpretation.allowedRecommendations).toContain('withhold');
  });

  it('generates dependency expectations', () => {
    const gate = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());

    expect(gate.runtimeActivationDependencies.join(' ')).toContain('authority');
    expect(gate.sectionRuntimeActivationReadiness[0].runtimeActivationDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const gate = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());

    expect(gate.runtimeActivationBoundaries.join(' ')).toContain('boundary');
    expect(gate.runtimeActivationPreservationRequirements.join(' ')).toContain('diagnose');
    expect(gate.sectionRuntimeActivationReadiness[0].runtimeActivationPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const gate = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());

    expect(gate.runtimeActivationVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(gate.sectionRuntimeActivationReadiness[0].runtimeActivationVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildActivationInput();
    const gate = buildValidatorRuntimeActivationReadinessGate({
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

    expect(gate.runtimeActivationRiskSignals.join(' ')).toContain('envelope risk');
    expect(gate.runtimeActivationGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(gate.sectionRuntimeActivationReadiness[0].runtimeActivationStatus).toBe('activation_hold');
  });

  it('packages section runtime activation readiness', () => {
    const gate = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());

    expect(gate.sectionRuntimeActivationReadiness).toHaveLength(1);
    expect(gate.sectionRuntimeActivationReadiness[0].runtimeActivationStatus).toBe('activation_ready');
    expect(gate.runtimeActivationInterpretation.advisoryOnly).toBe(true);
  });

  it('serializes compact runtime activation readiness gates', () => {
    const gate = buildValidatorRuntimeActivationReadinessGate(buildActivationInput());
    const serialized = serializeValidatorRuntimeActivationReadinessGate(gate);

    expect(serialized).toContain('## VALIDATOR RUNTIME ACTIVATION READINESS GATE');
    expect(serialized).toContain('Runtime activation:');
    expect(serialized).toContain('Runtime activation recommendation:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
