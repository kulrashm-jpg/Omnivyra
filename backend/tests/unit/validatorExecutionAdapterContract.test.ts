import {
  buildValidatorExecutionAdapterContract,
  serializeValidatorExecutionAdapterContract,
} from '../../../lib/content/validatorExecutionAdapterContract';

function buildAdapterInput() {
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
    sectionPreflightReadiness: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      preflightReadiness: 'ready' as const,
      preflightEligibility: 'eligible' as const,
      dependencyCoverage: ['0. narrative', '1. authority'],
      boundaryCoverage: ['preserve section boundary'],
      preservationCoverage: ['preserve progression stage: diagnose'],
      executionCoverage: ['handoff section 0'],
      gapSignals: [],
    }],
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
  const validatorExecutionPreparation = {
    version: 'validator-execution-preparation-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallExecutionPreparationReadiness: 'ready' as const,
    executionPreparationSignals: ['handoff readiness: ready', 'validator execution preparation remains non-executing'],
    executionPreparationDependencies: ['0. narrative', '1. authority'],
    executionPreparationBoundaries: ['preserve section boundary'],
    executionPreparationPreservationSignals: ['preserve progression stage: diagnose'],
    executionPreparationRisks: [],
    sectionExecutionPreparation: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      executionPreparationEligibility: 'eligible' as const,
      executionPreparationSignals: ['handoff section 0'],
      dependencies: ['0. narrative', '1. authority'],
      boundaries: ['preserve section boundary'],
      preservationSignals: ['preserve progression stage: diagnose'],
      risks: [],
    }],
    executionPreparationConfidence: 'high' as const,
  };
  const validatorHandoffManifest = {
    version: 'validator-handoff-manifest-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallHandoffManifestReadiness: 'ready' as const,
    handoffExecutionPayload: ['validator handoff package is non-executing'],
    handoffBoundaryRequirements: ['preserve section boundary'],
    handoffPreservationRequirements: ['preserve progression stage: diagnose'],
    handoffDependencyRequirements: ['0. narrative', '1. authority'],
    handoffReviewRequirements: ['decision section: 0'],
    sectionHandoffPayloads: [],
    handoffManifestRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    handoffManifestConfidence: 'high' as const,
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
    validatorPreflightReadinessGate,
    validatorOperationalReadiness,
    validatorExecutionPreparation,
    validatorHandoffManifest,
    validatorDecisionTrace,
  };
}

describe('validatorExecutionAdapterContract', () => {
  it('generates deterministic adapter contracts', () => {
    const first = buildValidatorExecutionAdapterContract(buildAdapterInput());
    const second = buildValidatorExecutionAdapterContract(buildAdapterInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-execution-adapter-contract-v1');
    expect(first.overallExecutionAdapterReadiness).toBe('ready');
  });

  it('generates input and output expectations', () => {
    const contract = buildValidatorExecutionAdapterContract(buildAdapterInput());

    expect(contract.executionAdapterInputs.join(' ')).toContain('preflight');
    expect(contract.executionAdapterOutputs.join(' ')).toContain('advisory');
  });

  it('generates dependency expectations', () => {
    const contract = buildValidatorExecutionAdapterContract(buildAdapterInput());

    expect(contract.executionAdapterDependencies.join(' ')).toContain('authority');
    expect(contract.sectionExecutionAdapters[0].adapterDependencies.join(' ')).toContain('narrative');
  });

  it('propagates boundary and preservation requirements', () => {
    const contract = buildValidatorExecutionAdapterContract(buildAdapterInput());

    expect(contract.executionAdapterBoundaries.join(' ')).toContain('boundary');
    expect(contract.executionAdapterPreservationRequirements.join(' ')).toContain('diagnose');
    expect(contract.sectionExecutionAdapters[0].adapterPreservationRequirements.join(' ')).toContain('diagnose');
  });

  it('generates gap signals from preflight gaps', () => {
    const input = buildAdapterInput();
    const contract = buildValidatorExecutionAdapterContract({
      ...input,
      validatorPreflightReadinessGate: {
        ...input.validatorPreflightReadinessGate,
        overallPreflightReadiness: 'conditional',
        preflightEligibility: 'deferred',
        preflightGapSignals: ['missing operational boundary coverage'],
        sectionPreflightReadiness: [{
          ...input.validatorPreflightReadinessGate.sectionPreflightReadiness[0],
          preflightReadiness: 'conditional',
          preflightEligibility: 'deferred',
          gapSignals: ['missing section boundary coverage'],
        }],
      },
    });

    expect(contract.overallExecutionAdapterReadiness).toBe('conditional');
    expect(contract.executionAdapterGapSignals.join(' ')).toContain('missing operational boundary coverage');
    expect(contract.sectionExecutionAdapters[0].adapterGapSignals.join(' ')).toContain('missing section boundary coverage');
  });

  it('packages section execution adapters', () => {
    const contract = buildValidatorExecutionAdapterContract(buildAdapterInput());

    expect(contract.sectionExecutionAdapters).toHaveLength(1);
    expect(contract.sectionExecutionAdapters[0].executionAdapterEligibility).toBe('eligible');
    expect(contract.sectionExecutionAdapters[0].adapterOutputs.join(' ')).toContain('validator');
  });

  it('serializes compact adapter contracts', () => {
    const contract = buildValidatorExecutionAdapterContract(buildAdapterInput());
    const serialized = serializeValidatorExecutionAdapterContract(contract);

    expect(serialized).toContain('## VALIDATOR EXECUTION ADAPTER CONTRACT');
    expect(serialized).toContain('Adapter readiness:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
