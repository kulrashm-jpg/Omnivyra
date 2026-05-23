import {
  buildValidatorRuntimeGovernanceEnvelope,
  serializeValidatorRuntimeGovernanceEnvelope,
} from '../../../lib/content/validatorRuntimeGovernanceEnvelope';

function buildGovernanceInput() {
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
    runtimeReadinessVerificationRequirements: ['runtime readiness envelope is advisory-only and must not gate runtime behavior'],
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
    validatorRuntimeReadinessEnvelope,
    validatorRuntimeEligibilityInterpretation,
    normalizedValidatorOutputEnvelope,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeGovernanceEnvelope', () => {
  it('generates deterministic runtime governance envelopes', () => {
    const first = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());
    const second = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-governance-envelope-v1');
    expect(first.overallRuntimeGovernanceReadiness).toBe('governance_ready');
  });

  it('interprets governance_ready, governance_conditional, and governance_not_ready states', () => {
    const ready = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());
    const conditionalInput = buildGovernanceInput();
    const conditional = buildValidatorRuntimeGovernanceEnvelope({
      ...conditionalInput,
      validatorRuntimeReadinessEnvelope: {
        ...conditionalInput.validatorRuntimeReadinessEnvelope,
        runtimeReadinessStatus: 'runtime_conditional',
        overallRuntimeReadiness: 'runtime_conditional',
        runtimeReadinessRiskSignals: ['runtime readiness risk'],
      },
    });
    const blockedInput = buildGovernanceInput();
    const blocked = buildValidatorRuntimeGovernanceEnvelope({
      ...blockedInput,
      validatorRuntimeEligibilityInterpretation: {
        ...blockedInput.validatorRuntimeEligibilityInterpretation,
        runtimeEligibilityStatus: 'runtime_not_ready',
        overallRuntimeEligibility: 'runtime_not_ready',
      },
    });

    expect(ready.runtimeGovernanceStatus).toBe('governance_ready');
    expect(conditional.runtimeGovernanceStatus).toBe('governance_conditional');
    expect(blocked.runtimeGovernanceStatus).toBe('governance_not_ready');
  });

  it('generates dependency expectations', () => {
    const envelope = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());

    expect(envelope.runtimeGovernanceDependencies.join(' ')).toContain('authority');
    expect(envelope.sectionRuntimeGovernance[0].runtimeGovernanceDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const envelope = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());

    expect(envelope.runtimeGovernanceBoundaries.join(' ')).toContain('boundary');
    expect(envelope.runtimeGovernancePreservationRequirements.join(' ')).toContain('diagnose');
    expect(envelope.sectionRuntimeGovernance[0].runtimeGovernancePreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const envelope = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());

    expect(envelope.runtimeGovernanceVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(envelope.sectionRuntimeGovernance[0].runtimeGovernanceVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildGovernanceInput();
    const envelope = buildValidatorRuntimeGovernanceEnvelope({
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

    expect(envelope.runtimeGovernanceRiskSignals.join(' ')).toContain('envelope risk');
    expect(envelope.runtimeGovernanceGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(envelope.sectionRuntimeGovernance[0].runtimeGovernanceStatus).toBe('governance_conditional');
  });

  it('packages section runtime governance', () => {
    const envelope = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());

    expect(envelope.sectionRuntimeGovernance).toHaveLength(1);
    expect(envelope.sectionRuntimeGovernance[0].runtimeGovernanceStatus).toBe('governance_ready');
    expect(envelope.runtimeGovernanceInterpretation.advisoryOnly).toBe(true);
  });

  it('serializes compact runtime governance envelopes', () => {
    const envelope = buildValidatorRuntimeGovernanceEnvelope(buildGovernanceInput());
    const serialized = serializeValidatorRuntimeGovernanceEnvelope(envelope);

    expect(serialized).toContain('## VALIDATOR RUNTIME GOVERNANCE ENVELOPE');
    expect(serialized).toContain('Runtime governance:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
