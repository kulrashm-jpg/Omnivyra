import {
  interpretValidatorRuntimeEligibility,
  serializeValidatorRuntimeEligibilityInterpretation,
} from '../../../lib/content/validatorRuntimeEligibilityInterpreter';

function buildRuntimeInput() {
  const validatorExecutionEligibilityPolicy = {
    version: 'validator-execution-eligibility-policy-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallExecutionEligibility: 'ready' as const,
    executionEligibilityStatus: 'ready' as const,
    executionEligibilityInputs: ['normalized validator output envelope'],
    executionEligibilityDependencies: ['0. narrative', '1. authority'],
    executionEligibilityBoundaries: ['preserve section boundary'],
    executionEligibilityPreservationRequirements: ['preserve progression stage: diagnose'],
    executionEligibilityVerificationRequirements: ['execution eligibility is advisory-only and must not gate runtime behavior'],
    executionEligibilityRiskSignals: [],
    executionEligibilityGapSignals: [],
    executionEligibilityPolicyModel: {
      allowedStatuses: ['ready', 'conditional', 'not_ready'] as const,
      defaultStatus: 'not_ready' as const,
      advisoryOnly: true,
    },
    sectionExecutionEligibility: [],
    executionEligibilityConfidence: 'high' as const,
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
    validatorExecutionEligibilityPolicy,
    normalizedValidatorOutputEnvelope,
    validatorOutputNormalizationContract,
    validatorPreflightReadinessGate,
    validatorDecisionTrace,
  };
}

describe('validatorRuntimeEligibilityInterpreter', () => {
  it('generates deterministic runtime eligibility interpretations', () => {
    const first = interpretValidatorRuntimeEligibility(buildRuntimeInput());
    const second = interpretValidatorRuntimeEligibility(buildRuntimeInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-runtime-eligibility-interpreter-v1');
    expect(first.overallRuntimeEligibility).toBe('runtime_ready');
  });

  it('interprets runtime_ready, runtime_conditional, and runtime_not_ready states', () => {
    const ready = interpretValidatorRuntimeEligibility(buildRuntimeInput());
    const conditionalInput = buildRuntimeInput();
    const conditional = interpretValidatorRuntimeEligibility({
      ...conditionalInput,
      validatorExecutionEligibilityPolicy: {
        ...conditionalInput.validatorExecutionEligibilityPolicy,
        executionEligibilityStatus: 'conditional',
        overallExecutionEligibility: 'conditional',
        executionEligibilityRiskSignals: ['eligibility risk'],
      },
    });
    const blockedInput = buildRuntimeInput();
    const blocked = interpretValidatorRuntimeEligibility({
      ...blockedInput,
      validatorExecutionEligibilityPolicy: {
        ...blockedInput.validatorExecutionEligibilityPolicy,
        executionEligibilityStatus: 'not_ready',
        overallExecutionEligibility: 'not_ready',
      },
    });

    expect(ready.runtimeEligibilityStatus).toBe('runtime_ready');
    expect(conditional.runtimeEligibilityStatus).toBe('runtime_conditional');
    expect(blocked.runtimeEligibilityStatus).toBe('runtime_not_ready');
  });

  it('generates dependency expectations', () => {
    const report = interpretValidatorRuntimeEligibility(buildRuntimeInput());

    expect(report.runtimeEligibilityDependencies.join(' ')).toContain('authority');
    expect(report.sectionRuntimeEligibility[0].runtimeEligibilityDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation expectations', () => {
    const report = interpretValidatorRuntimeEligibility(buildRuntimeInput());

    expect(report.runtimeEligibilityBoundaries.join(' ')).toContain('boundary');
    expect(report.runtimeEligibilityPreservationRequirements.join(' ')).toContain('diagnose');
    expect(report.sectionRuntimeEligibility[0].runtimeEligibilityPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('propagates verification expectations', () => {
    const report = interpretValidatorRuntimeEligibility(buildRuntimeInput());

    expect(report.runtimeEligibilityVerificationRequirements.join(' ')).toContain('advisory-only');
    expect(report.sectionRuntimeEligibility[0].runtimeEligibilityVerificationRequirements.join(' ')).toContain('advisory-only');
  });

  it('generates risk and gap signals', () => {
    const input = buildRuntimeInput();
    const report = interpretValidatorRuntimeEligibility({
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

    expect(report.runtimeEligibilityRiskSignals.join(' ')).toContain('envelope risk');
    expect(report.runtimeEligibilityGapSignals.join(' ')).toContain('missing envelope dependency');
    expect(report.sectionRuntimeEligibility[0].runtimeEligibilityStatus).toBe('runtime_conditional');
  });

  it('packages section runtime eligibility', () => {
    const report = interpretValidatorRuntimeEligibility(buildRuntimeInput());

    expect(report.sectionRuntimeEligibility).toHaveLength(1);
    expect(report.sectionRuntimeEligibility[0].runtimeEligibilityStatus).toBe('runtime_ready');
    expect(report.runtimeEligibilityPolicyInterpretation.advisoryOnly).toBe(true);
  });

  it('serializes compact runtime eligibility interpretations', () => {
    const report = interpretValidatorRuntimeEligibility(buildRuntimeInput());
    const serialized = serializeValidatorRuntimeEligibilityInterpretation(report);

    expect(serialized).toContain('## VALIDATOR RUNTIME ELIGIBILITY');
    expect(serialized).toContain('Runtime eligibility:');
    expect(serialized).toContain('Allowed statuses:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
