import {
  buildValidatorRuntimeRolloutClosureEnvelope,
  serializeValidatorRuntimeRolloutClosureEnvelope,
} from '../../../lib/content/validatorRuntimeRolloutClosureEnvelope';

function buildInput() {
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
    validatorRuntimeStabilizationEnvelope,
    validatorRuntimeGovernanceEnvelope,
    validatorRuntimeReadinessEnvelope,
    validatorRuntimeEligibilityInterpretation,
    normalizedValidatorOutputEnvelope,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeRolloutClosureEnvelope', () => {
  it('generates a deterministic rollout closure envelope', () => {
    const first = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    const second = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-rollout-closure-envelope-v1');
    expect(first.overallRuntimeRolloutReadiness).toBe('rollout_ready');
  });

  it('interprets rollout_ready, rollout_conditional, and rollout_not_ready', () => {
    const ready = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    const conditionalInput = buildInput();
    const conditional = buildValidatorRuntimeRolloutClosureEnvelope({
      ...conditionalInput,
      validatorRuntimeStabilizationEnvelope: {
        ...conditionalInput.validatorRuntimeStabilizationEnvelope,
        runtimeStabilizationStatus: 'stabilization_conditional',
        overallRuntimeStabilizationReadiness: 'stabilization_conditional',
      },
    });
    const notReadyInput = buildInput();
    const notReady = buildValidatorRuntimeRolloutClosureEnvelope({
      ...notReadyInput,
      validatorRuntimeGovernanceEnvelope: {
        ...notReadyInput.validatorRuntimeGovernanceEnvelope,
        runtimeGovernanceStatus: 'governance_not_ready',
        overallRuntimeGovernanceReadiness: 'governance_not_ready',
      },
    });

    expect(ready.runtimeRolloutStatus).toBe('rollout_ready');
    expect(conditional.runtimeRolloutStatus).toBe('rollout_conditional');
    expect(notReady.runtimeRolloutStatus).toBe('rollout_not_ready');
  });

  it('generates advisory recommendations per status', () => {
    const ready = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    expect(ready.runtimeRolloutRecommendations).toEqual(['safe_for_shadow_only']);

    const conditionalInput = buildInput();
    const conditional = buildValidatorRuntimeRolloutClosureEnvelope({
      ...conditionalInput,
      validatorRuntimeStabilizationEnvelope: {
        ...conditionalInput.validatorRuntimeStabilizationEnvelope,
        runtimeStabilizationStatus: 'stabilization_conditional',
        overallRuntimeStabilizationReadiness: 'stabilization_conditional',
      },
    });
    expect(conditional.runtimeRolloutRecommendations).toContain('requires_runtime_stabilization');
    expect(conditional.runtimeRolloutRecommendations).toContain('requires_additional_soak');

    const notReadyInput = buildInput();
    const notReady = buildValidatorRuntimeRolloutClosureEnvelope({
      ...notReadyInput,
      validatorRuntimeReadinessEnvelope: {
        ...notReadyInput.validatorRuntimeReadinessEnvelope,
        runtimeReadinessStatus: 'runtime_not_ready',
        overallRuntimeReadiness: 'runtime_not_ready',
      },
    });
    expect(notReady.runtimeRolloutRecommendations).toContain('not_ready_for_activation_design');
  });

  it('escalates on risk signals', () => {
    const input = buildInput();
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope({
      ...input,
      normalizedValidatorOutputEnvelope: {
        ...input.normalizedValidatorOutputEnvelope,
        normalizedEnvelopeRiskSignals: ['envelope rollout risk'],
      },
    });
    expect(envelope.runtimeRolloutStatus).toBe('rollout_conditional');
    expect(envelope.runtimeRolloutRiskSignals.join(' ')).toContain('envelope rollout risk');
  });

  it('escalates to rollout_not_ready on excessive gap signals', () => {
    const input = buildInput();
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope({
      ...input,
      normalizedValidatorOutputEnvelope: {
        ...input.normalizedValidatorOutputEnvelope,
        normalizedEnvelopeGapSignals: ['gap one', 'gap two', 'gap three'],
      },
    });
    expect(envelope.runtimeRolloutStatus).toBe('rollout_not_ready');
    expect(envelope.runtimeRolloutGapSignals.length).toBeGreaterThan(2);
    expect(envelope.runtimeRolloutRecommendations).toContain('requires_dependency_resolution');
  });

  it('packages section rollout readiness', () => {
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    expect(envelope.sectionRuntimeRolloutReadiness).toHaveLength(1);
    const section = envelope.sectionRuntimeRolloutReadiness[0];
    expect(section.runtimeRolloutStatus).toBe('rollout_ready');
    expect(section.runtimeRolloutRecommendations).toEqual(['safe_for_shadow_only']);
    expect(section.runtimeRolloutConfidence).toBe('high');
  });

  it('propagates boundary and preservation expectations', () => {
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    expect(envelope.runtimeRolloutBoundaries.join(' ')).toContain('boundary');
    expect(envelope.runtimeRolloutPreservationRequirements.join(' ')).toContain('diagnose');
    expect(envelope.sectionRuntimeRolloutReadiness[0].runtimeRolloutBoundaries.join(' ')).toContain('boundary');
    expect(envelope.sectionRuntimeRolloutReadiness[0].runtimeRolloutPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('guarantees advisory-only semantics', () => {
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    expect(envelope.runtimeRolloutInterpretation.advisoryOnly).toBe(true);
    expect(envelope.runtimeRolloutVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(envelope.runtimeRolloutVerificationRequirements.join(' ')).toContain('must not trigger activation');
  });

  it('serializes compact deterministic rollout closure envelopes', () => {
    const envelope = buildValidatorRuntimeRolloutClosureEnvelope(buildInput());
    const serialized = serializeValidatorRuntimeRolloutClosureEnvelope(envelope);

    expect(serialized).toContain('## VALIDATOR RUNTIME ROLLOUT CLOSURE ENVELOPE');
    expect(serialized).toContain('Runtime rollout:');
    expect(serialized).toContain('Recommendations:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
