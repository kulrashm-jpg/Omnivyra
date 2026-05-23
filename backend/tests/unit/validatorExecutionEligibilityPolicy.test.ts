import {
  buildValidatorExecutionEligibilityPolicy,
  serializeValidatorExecutionEligibilityPolicy,
} from '../../../lib/content/validatorExecutionEligibilityPolicy';

function buildPolicyInput() {
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
    normalizedValidatorOutputEnvelope,
    validatorOutputNormalizationContract,
    validatorInvocationResultContract,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorExecutionEligibilityPolicy', () => {
  it('generates deterministic eligibility policies', () => {
    const first = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());
    const second = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-execution-eligibility-policy-v1');
    expect(first.overallExecutionEligibility).toBe('ready');
  });

  it('interprets ready, conditional, and not_ready states', () => {
    const ready = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());
    const conditionalInput = buildPolicyInput();
    const conditional = buildValidatorExecutionEligibilityPolicy({
      ...conditionalInput,
      normalizedValidatorOutputEnvelope: {
        ...conditionalInput.normalizedValidatorOutputEnvelope,
        overallNormalizedEnvelopeReadiness: 'conditional',
        normalizedEnvelopeEligibility: 'deferred',
        normalizedEnvelopeRiskSignals: ['normalization risk'],
      },
    });
    const blockedInput = buildPolicyInput();
    const blocked = buildValidatorExecutionEligibilityPolicy({
      ...blockedInput,
      normalizedValidatorOutputEnvelope: {
        ...blockedInput.normalizedValidatorOutputEnvelope,
        overallNormalizedEnvelopeReadiness: 'blocked',
        normalizedEnvelopeEligibility: 'not_recommended',
      },
    });

    expect(ready.executionEligibilityStatus).toBe('ready');
    expect(conditional.executionEligibilityStatus).toBe('conditional');
    expect(blocked.executionEligibilityStatus).toBe('not_ready');
  });

  it('generates dependency expectations', () => {
    const policy = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());

    expect(policy.executionEligibilityDependencies.join(' ')).toContain('authority');
    expect(policy.sectionExecutionEligibility[0].eligibilityDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const policy = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());

    expect(policy.executionEligibilityBoundaries.join(' ')).toContain('boundary');
    expect(policy.executionEligibilityPreservationRequirements.join(' ')).toContain('diagnose');
    expect(policy.sectionExecutionEligibility[0].eligibilityPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const policy = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());

    expect(policy.executionEligibilityVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(policy.sectionExecutionEligibility[0].eligibilityVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildPolicyInput();
    const policy = buildValidatorExecutionEligibilityPolicy({
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

    expect(policy.executionEligibilityRiskSignals.join(' ')).toContain('envelope risk');
    expect(policy.executionEligibilityGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(policy.sectionExecutionEligibility[0].executionEligibilityStatus).toBe('conditional');
  });

  it('packages section eligibility', () => {
    const policy = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());

    expect(policy.sectionExecutionEligibility).toHaveLength(1);
    expect(policy.sectionExecutionEligibility[0].executionEligibilityStatus).toBe('ready');
    expect(policy.executionEligibilityPolicyModel.advisoryOnly).toBe(true);
  });

  it('serializes compact eligibility policies', () => {
    const policy = buildValidatorExecutionEligibilityPolicy(buildPolicyInput());
    const serialized = serializeValidatorExecutionEligibilityPolicy(policy);

    expect(serialized).toContain('## VALIDATOR EXECUTION ELIGIBILITY POLICY');
    expect(serialized).toContain('Execution eligibility:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
