import {
  evaluateValidatorPreflightReadiness,
  serializeValidatorPreflightReadinessGate,
} from '../../../lib/content/validatorPreflightReadinessGate';

function buildPreflightInput() {
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
  const validatorOperationalReadiness = {
    version: 'validator-operational-readiness-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallOperationalReadiness: 'ready' as const,
    operationalCoverageSignals: ['handoff readiness: ready', 'coverage ledger entries: 2'],
    operationalDependencySignals: ['0. narrative', '1. authority'],
    operationalBoundaryCoverage: ['preserve section boundary'],
    operationalPreservationCoverage: ['preserve progression stage: diagnose'],
    operationalGapSignals: [],
    sectionOperationalReadiness: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      operationalReadiness: 'ready' as const,
      operationalCoverageSignals: ['handoff section 0'],
      operationalDependencySignals: ['0. narrative', '1. authority'],
      operationalBoundaryCoverage: ['preserve section boundary'],
      operationalPreservationCoverage: ['preserve progression stage: diagnose'],
      operationalGapSignals: [],
    }],
    operationalReadinessConfidence: 'high' as const,
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
    sectionHandoffPayloads: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      handoffEligibility: 'eligible' as const,
      handoffPayload: ['handoff section 0'],
      boundaryRequirements: ['preserve section boundary'],
      preservationRequirements: ['preserve progression stage: diagnose'],
      dependencyRequirements: ['0. narrative', '1. authority'],
      reviewRequirements: ['future validator must remain non-mutating until execution layer is explicitly enabled'],
    }],
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
  const validatorCoverageLedger = {
    version: 'validator-coverage-ledger-v1' as const,
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    overallCoverageLedgerReadiness: 'ready' as const,
    coverageLedgerEntries: ['result preservation requirements: 1', 'result boundary requirements: 1'],
    boundaryCoverageLedger: ['preserve section boundary'],
    preservationCoverageLedger: ['preserve progression stage: diagnose'],
    decisionCoverageLedger: ['decision priority: high'],
    dependencyCoverageLedger: ['0. narrative', '1. authority'],
    sectionCoverageLedger: [{
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      coverageLedger: ['section 0 recovery decision eligibility: acceptable'],
      boundaryCoverage: ['preserve section boundary'],
      preservationCoverage: ['preserve progression stage: diagnose'],
      decisionCoverage: ['decision priority: high'],
      dependencyCoverage: ['0. narrative', '1. authority'],
    }],
    coverageLedgerRiskProfile: {
      lowRisk: 2,
      mediumRisk: 0,
      highRisk: 0,
      gaps: 0,
      deferred: 0,
    },
    coverageLedgerConfidence: 'high' as const,
  };

  return {
    validatorOperationalReadiness,
    validatorExecutionPreparation,
    validatorHandoffManifest,
    validatorDecisionTrace,
    validatorCoverageLedger,
  };
}

describe('validatorPreflightReadinessGate', () => {
  it('generates deterministic preflight readiness', () => {
    const first = evaluateValidatorPreflightReadiness(buildPreflightInput());
    const second = evaluateValidatorPreflightReadiness(buildPreflightInput());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('validator-preflight-readiness-gate-v1');
    expect(first.overallPreflightReadiness).toBe('ready');
  });

  it('evaluates dependency coverage', () => {
    const gate = evaluateValidatorPreflightReadiness(buildPreflightInput());

    expect(gate.preflightDependencyCoverage.join(' ')).toContain('authority');
    expect(gate.sectionPreflightReadiness[0].dependencyCoverage.join(' ')).toContain('narrative');
  });

  it('evaluates boundary and preservation coverage', () => {
    const gate = evaluateValidatorPreflightReadiness(buildPreflightInput());

    expect(gate.preflightBoundaryCoverage.join(' ')).toContain('boundary');
    expect(gate.preflightPreservationCoverage.join(' ')).toContain('diagnose');
  });

  it('evaluates execution coverage', () => {
    const gate = evaluateValidatorPreflightReadiness(buildPreflightInput());

    expect(gate.preflightExecutionCoverage.join(' ')).toContain('non-executing');
    expect(gate.sectionPreflightReadiness[0].executionCoverage.join(' ')).toContain('handoff section');
  });

  it('generates gap signals when coverage is missing', () => {
    const input = buildPreflightInput();
    const gate = evaluateValidatorPreflightReadiness({
      ...input,
      validatorOperationalReadiness: {
        ...input.validatorOperationalReadiness,
        operationalBoundaryCoverage: [],
      },
    });

    expect(gate.overallPreflightReadiness).toBe('conditional');
    expect(gate.preflightGapSignals.join(' ')).toContain('missing operational boundary coverage');
  });

  it('packages section preflight readiness', () => {
    const gate = evaluateValidatorPreflightReadiness(buildPreflightInput());

    expect(gate.sectionPreflightReadiness).toHaveLength(1);
    expect(gate.sectionPreflightReadiness[0].preflightEligibility).toBe('eligible');
    expect(gate.sectionPreflightReadiness[0].preservationCoverage.join(' ')).toContain('diagnose');
  });

  it('serializes compact preflight readiness', () => {
    const gate = evaluateValidatorPreflightReadiness(buildPreflightInput());
    const serialized = serializeValidatorPreflightReadinessGate(gate);

    expect(serialized).toContain('## VALIDATOR PREFLIGHT READINESS GATE');
    expect(serialized).toContain('Preflight readiness:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
