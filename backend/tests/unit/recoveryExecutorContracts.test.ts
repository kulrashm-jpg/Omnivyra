import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { observeBehavioralAdherenceDiagnostics } from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { buildEditorialQualityReadiness } from '../../../lib/content/editorialQualityReadiness';
import { buildEditorialQualitySignals } from '../../../lib/content/editorialQualitySignals';
import { observeEditorialDiagnostics } from '../../../lib/content/editorialDiagnosticObserver';
import { assembleEditorialRemediationPlan } from '../../../lib/content/editorialRemediationPlanAssembler';
import { buildEditorialRemediationHints } from '../../../lib/content/editorialRemediationHints';
import { selectRegenerationCandidates } from '../../../lib/content/regenerationCandidateSelector';
import { buildRegenerationExecutionManifest } from '../../../lib/content/regenerationExecutionManifest';
import { buildRegenerationReadinessContract } from '../../../lib/content/regenerationReadinessContracts';
import { planRecoveryExecutionDryRun } from '../../../lib/content/recoveryExecutionDryRunPlanner';
import {
  buildRecoveryExecutorContracts,
  serializeRecoveryExecutorContracts,
} from '../../../lib/content/recoveryExecutorContracts';
import { prioritizeEditorialRuntimeContext } from '../../../lib/content/editorialRuntimeContextPrioritizer';
import { buildGeneratorBehavioralSteering } from '../../../lib/content/generatorBehavioralSteering';
import { buildGeneratorRuntimeAlignment } from '../../../lib/content/generatorRuntimeAlignment';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import { assembleUnifiedEditorialBrief } from '../../../lib/content/unifiedEditorialBriefAssembler';

const companyContext = {
  companyName: 'SignalForge',
  audience: 'growth operators',
  industry: 'marketing intelligence',
  coreProblemStatement: 'teams cannot connect campaign signals to daily execution decisions',
  uniqueValue: 'turns marketing signals into governed execution choices',
  competitiveAdvantages: 'workflow governance and closed-loop attribution',
  productsServices: 'an AI marketing intelligence workspace',
  authorityDomains: ['marketing intelligence', 'content operations'],
  desiredTransformation: 'from scattered campaign activity to governed execution intelligence',
};

function buildContractInput(contentHtml: string) {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount: 6,
  });
  const generationGuidance = buildGenerationGuidanceContract({ doctrine, assimilation, narrativePlanning });
  const editorialDepth = buildEditorialDepthIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  });
  const editorialAuthority = buildEditorialAuthorityIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
  });
  const audienceMaturity = buildAudienceMaturityIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
  });
  const unifiedEditorialBrief = assembleUnifiedEditorialBrief({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  });
  const editorialRuntimeContext = prioritizeEditorialRuntimeContext({
    unifiedEditorialBrief,
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
  });
  const generatorRuntimeAlignment = buildGeneratorRuntimeAlignment({
    editorialRuntimeContext,
    unifiedEditorialBrief,
    narrativePlanning,
    generationGuidance,
  });
  const generatorBehavioralSteering = buildGeneratorBehavioralSteering({
    generatorRuntimeAlignment,
    editorialRuntimeContext,
    unifiedEditorialBrief,
  });
  const generatedContent = {
    title: 'AI Content Operations',
    excerpt: 'A governed approach to content operations.',
    content_html: contentHtml,
    key_insights: ['Executor contracts must preserve workflow proof and reader-state movement.'],
  };
  const editorialDiagnostics = observeEditorialDiagnostics({
    generatedContent,
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  });
  const behavioralAdherenceDiagnostics = observeBehavioralAdherenceDiagnostics({
    generatedContent,
    generatorBehavioralSteering,
    generatorRuntimeAlignment,
    unifiedEditorialBrief,
    editorialRuntimeContext,
  });
  const editorialQualitySignals = buildEditorialQualitySignals({
    editorialDiagnostics,
    behavioralAdherenceDiagnostics,
    generatorBehavioralSteering,
    generatorRuntimeAlignment,
  });
  const editorialQualityReadiness = buildEditorialQualityReadiness({
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
    editorialDiagnostics,
    generatorRuntimeAlignment,
  });
  const editorialRemediationHints = buildEditorialRemediationHints({
    editorialQualityReadiness,
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
    editorialDiagnostics,
  });
  const editorialRemediationPlan = assembleEditorialRemediationPlan({
    editorialRemediationHints,
    editorialQualityReadiness,
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
  });
  const regenerationReadinessContract = buildRegenerationReadinessContract({
    editorialRemediationPlan,
    editorialRemediationHints,
    editorialQualityReadiness,
    behavioralAdherenceDiagnostics,
  });
  const regenerationCandidateSelection = selectRegenerationCandidates({
    regenerationReadinessContract,
    editorialRemediationPlan,
    editorialQualityReadiness,
    behavioralAdherenceDiagnostics,
  });
  const regenerationExecutionManifest = buildRegenerationExecutionManifest({
    regenerationCandidateSelection,
    regenerationReadinessContract,
    editorialRemediationPlan,
    editorialQualityReadiness,
  });
  const recoveryExecutionDryRun = planRecoveryExecutionDryRun({
    regenerationExecutionManifest,
    regenerationCandidateSelection,
    regenerationReadinessContract,
    editorialRemediationPlan,
  });

  return {
    recoveryExecutionDryRun,
    regenerationExecutionManifest,
    regenerationCandidateSelection,
    regenerationReadinessContract,
  };
}

const alignedHtml = `
<h2>Diagnose the operating tension</h2>
<p>Growth operators feel the pain when teams cannot connect campaign signals to daily execution decisions. The hidden cause is weak upstream context, unclear workflow ownership, and decision stakes that never reach the content brief.</p>
<h2>Reframe the default assumption</h2>
<p>The default assumption is that more articles create authority. Instead, SignalForge should reframe AI content operations around workflow governance, closed-loop attribution, and the belief that generic content reflects weak operating context.</p>
<h2>Expand the mechanism</h2>
<p>The mechanism is an execution intelligence loop. It separates insight, priority, proof, and publishing so the implication is causal rather than decorative.</p>
<h2>Operationalize the workflow</h2>
<p>The workflow should name an owner, decision point, review check, handoff, tradeoff, and constraint. That operating sequence changes how operators prioritize work and approve output.</p>
<h2>Validate the proof behavior</h2>
<p>Proof should be handled through evidence, scenario limits, constraints, and qualified claims. When verified metrics are unavailable, the recommendation should stay bounded rather than inflated.</p>
<h2>Resolve the operating implication</h2>
<p>Ultimately, the operating implication is that governed generation compounds only when strategic tension, workflow realism, proof boundaries, and authority discipline stay connected.</p>
`;

function withInjectedSection(input: ReturnType<typeof buildContractInput>) {
  const firstCandidate = input.regenerationCandidateSelection.sectionRecoveryCandidates[0];
  if (!firstCandidate) return input;
  const selectedCandidate = {
    ...firstCandidate,
    risk: 'low' as const,
    eligibility: 'eligible' as const,
  };
  const manifest = {
    sectionIndex: selectedCandidate.sectionIndex,
    progressionStage: selectedCandidate.progressionStage,
    narrativeRole: selectedCandidate.narrativeRole,
    executionPriority: selectedCandidate.priority,
    executionReadiness: 'conditional' as const,
    recoveryTargets: selectedCandidate.recoveryTargets,
    rewriteBoundaries: selectedCandidate.rewriteBoundaries,
    preservationRequirements: selectedCandidate.preservationRequirements,
    executionConstraints: ['non-executing executor test manifest'],
  };
  const regenerationCandidateSelection = {
    ...input.regenerationCandidateSelection,
    sectionRecoveryCandidates: [selectedCandidate],
  };
  const regenerationExecutionManifest = {
    ...input.regenerationExecutionManifest,
    manifestExecutionOrder: [selectedCandidate.sectionIndex],
    sectionExecutionManifests: [manifest],
  };
  return {
    ...input,
    regenerationCandidateSelection,
    regenerationExecutionManifest,
    recoveryExecutionDryRun: {
      ...input.recoveryExecutionDryRun,
      dryRunExecutionOrder: [selectedCandidate.sectionIndex],
      sectionDryRunPlans: [{
        sectionIndex: selectedCandidate.sectionIndex,
        progressionStage: selectedCandidate.progressionStage,
        narrativeRole: selectedCandidate.narrativeRole,
        simulatedExecutionReadiness: 'conditional' as const,
        simulatedRisk: 'low' as const,
        recoveryTargets: selectedCandidate.recoveryTargets,
        preservationChecks: selectedCandidate.preservationRequirements,
        dependencyChecks: ['execution order index: 0'],
        conflictSignals: [],
      }],
    },
  };
}

describe('recoveryExecutorContracts', () => {
  it('generates deterministic executor contracts', () => {
    const first = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));
    const second = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('recovery-executor-contracts-v1');
  });

  it('maps input and output requirements', () => {
    const report = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));

    expect(report.executorInputRequirements).toContain('original generated content');
    expect(report.executorOutputRequirements.join(' ')).toContain('preservation verification');
  });

  it('maps preservation and boundary requirements', () => {
    const report = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));

    expect(report.executorPreservationRequirements.join(' ')).toContain('narrative');
    expect(report.executorBoundaryRequirements.join(' ')).toContain('preserve');
  });

  it('generates dependency and verification requirements', () => {
    const report = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));

    expect(report.executorDependencyRequirements.length).toBeGreaterThan(0);
    expect(report.executorVerificationRequirements.join(' ')).toContain('verify');
  });

  it('packages section executor contracts', () => {
    const report = buildRecoveryExecutorContracts(withInjectedSection(buildContractInput(alignedHtml)));

    expect(report.sectionExecutorContracts.length).toBeGreaterThan(0);
    expect(report.sectionExecutorContracts[0].inputRequirements.join(' ')).toContain('section dry-run plan');
    expect(report.sectionExecutorContracts[0].boundaryRequirements.length).toBeGreaterThan(0);
  });

  it('packages execution sequence', () => {
    const report = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));

    expect(Array.isArray(report.executorExecutionSequence)).toBe(true);
    expect(Array.isArray(report.executorDeferredTargets)).toBe(true);
  });

  it('serializes compact executor contracts', () => {
    const report = buildRecoveryExecutorContracts(buildContractInput(alignedHtml));
    const serialized = serializeRecoveryExecutorContracts(report);

    expect(serialized).toContain('## RECOVERY EXECUTOR CONTRACTS');
    expect(serialized).toContain('Executor readiness:');
    expect(serialized).toContain('Section contracts:');
    expect(serialized.length).toBeLessThan(1800);
  });
});
