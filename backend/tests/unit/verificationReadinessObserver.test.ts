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
import { buildExecutorVerificationContracts } from '../../../lib/content/executorVerificationContracts';
import { selectRegenerationCandidates } from '../../../lib/content/regenerationCandidateSelector';
import { buildRegenerationExecutionManifest } from '../../../lib/content/regenerationExecutionManifest';
import { buildRegenerationReadinessContract } from '../../../lib/content/regenerationReadinessContracts';
import { planRecoveryExecutionDryRun } from '../../../lib/content/recoveryExecutionDryRunPlanner';
import { buildRecoveryExecutorContracts } from '../../../lib/content/recoveryExecutorContracts';
import {
  observeVerificationReadiness,
  serializeVerificationReadinessObservation,
} from '../../../lib/content/verificationReadinessObserver';
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

function buildObserverInput(contentHtml: string) {
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
    key_insights: ['Verification observation must preserve workflow proof and reader-state movement.'],
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
  const recoveryExecutorContracts = buildRecoveryExecutorContracts({
    recoveryExecutionDryRun,
    regenerationExecutionManifest,
    regenerationCandidateSelection,
    regenerationReadinessContract,
  });
  const executorVerificationContracts = buildExecutorVerificationContracts({
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
    regenerationExecutionManifest,
    regenerationReadinessContract,
  });

  return {
    executorVerificationContracts,
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
    regenerationExecutionManifest,
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

describe('verificationReadinessObserver', () => {
  it('generates deterministic verification observations', () => {
    const first = observeVerificationReadiness(buildObserverInput(alignedHtml));
    const second = observeVerificationReadiness(buildObserverInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('verification-readiness-observer-v1');
  });

  it('maps coverage completeness', () => {
    const observation = observeVerificationReadiness(buildObserverInput(alignedHtml));

    expect(observation.verificationCompletenessSignals.join(' ')).toContain('input requirements');
    expect(observation.verificationCoverageStatus).toBeTruthy();
  });

  it('maps preservation and boundary coverage', () => {
    const observation = observeVerificationReadiness(buildObserverInput(alignedHtml));

    expect(observation.preservationCoverageSignals.join(' ')).toContain('narrative');
    expect(observation.boundaryCoverageSignals.join(' ')).toContain('preserve');
  });

  it('maps dependency coverage', () => {
    const observation = observeVerificationReadiness(buildObserverInput(alignedHtml));

    expect(observation.dependencyCoverageSignals.length).toBeGreaterThan(0);
  });

  it('packages section coverage and gap signals', () => {
    const input = buildObserverInput(alignedHtml);
    const sectionContract = {
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      verificationEligibility: 'eligible' as const,
      verificationInputRequirements: ['executor output'],
      verificationOutputRequirements: ['verification report'],
      preservationChecks: [],
      boundaryChecks: [],
      dependencyChecks: ['execution order index: 0'],
      narrativeChecks: ['preserve progression stage: diagnose'],
      authorityChecks: ['verify evidence'],
      antiRepetitionChecks: ['verify distinct section responsibility'],
      recoveryChecks: ['verify recovery target'],
    };
    const observation = observeVerificationReadiness({
      ...input,
      executorVerificationContracts: {
        ...input.executorVerificationContracts,
        sectionVerificationContracts: [sectionContract],
      },
    });

    expect(observation.sectionVerificationCoverage).toHaveLength(1);
    expect(observation.sectionVerificationCoverage[0].coverageStatus).toBe('partial');
    expect(observation.verificationGapSignals.join(' ')).toContain('missing preservation coverage');
  });

  it('serializes compact verification observations', () => {
    const observation = observeVerificationReadiness(buildObserverInput(alignedHtml));
    const serialized = serializeVerificationReadinessObservation(observation);

    expect(serialized).toContain('## VERIFICATION READINESS OBSERVATION');
    expect(serialized).toContain('Coverage status:');
    expect(serialized).toContain('Gap signals:');
    expect(serialized.length).toBeLessThan(2200);
  });
});
