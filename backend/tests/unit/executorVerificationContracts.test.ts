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
import {
  buildExecutorVerificationContracts,
  serializeExecutorVerificationContracts,
} from '../../../lib/content/executorVerificationContracts';
import { selectRegenerationCandidates } from '../../../lib/content/regenerationCandidateSelector';
import { buildRegenerationExecutionManifest } from '../../../lib/content/regenerationExecutionManifest';
import { buildRegenerationReadinessContract } from '../../../lib/content/regenerationReadinessContracts';
import { planRecoveryExecutionDryRun } from '../../../lib/content/recoveryExecutionDryRunPlanner';
import { buildRecoveryExecutorContracts } from '../../../lib/content/recoveryExecutorContracts';
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

function buildVerificationInput(contentHtml: string) {
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
    key_insights: ['Verification contracts must preserve workflow proof and reader-state movement.'],
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

  return {
    recoveryExecutorContracts,
    recoveryExecutionDryRun,
    regenerationExecutionManifest,
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

describe('executorVerificationContracts', () => {
  it('generates deterministic verification contracts', () => {
    const first = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));
    const second = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('executor-verification-contracts-v1');
  });

  it('maps verification input and output requirements', () => {
    const report = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));

    expect(report.verificationInputRequirements).toContain('executor output package');
    expect(report.verificationOutputRequirements.join(' ')).toContain('verification report');
  });

  it('generates preservation and boundary checks', () => {
    const report = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));

    expect(report.verificationPreservationChecks.join(' ')).toContain('narrative');
    expect(report.verificationBoundaryChecks.join(' ')).toContain('preserve');
  });

  it('generates dependency checks', () => {
    const report = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));

    expect(report.verificationDependencyChecks.length).toBeGreaterThan(0);
  });

  it('packages section verification contracts', () => {
    const input = buildVerificationInput(alignedHtml);
    const sectionContract = {
      sectionIndex: 0,
      progressionStage: 'diagnose' as const,
      narrativeRole: 'problem_diagnosis' as const,
      executorEligibility: 'eligible' as const,
      executionPriority: 'medium' as const,
      inputRequirements: ['source section content'],
      outputRequirements: ['preservation verification notes'],
      preservationRequirements: ['preserve progression stage: diagnose'],
      boundaryRequirements: ['preserve section boundary'],
      dependencyRequirements: ['execution order index: 0'],
      verificationRequirements: ['verify recovery target'],
      recoveryTargets: ['narrative recovery'],
    };
    const report = buildExecutorVerificationContracts({
      ...input,
      recoveryExecutorContracts: {
        ...input.recoveryExecutorContracts,
        sectionExecutorContracts: [sectionContract],
      },
      recoveryExecutionDryRun: {
        ...input.recoveryExecutionDryRun,
        sectionDryRunPlans: [{
          sectionIndex: 0,
          progressionStage: 'diagnose',
          narrativeRole: 'problem_diagnosis',
          simulatedExecutionReadiness: 'conditional',
          simulatedRisk: 'low',
          recoveryTargets: ['narrative recovery'],
          preservationChecks: ['preserve progression stage: diagnose'],
          dependencyChecks: ['execution order index: 0'],
          conflictSignals: [],
        }],
      },
    });

    expect(report.sectionVerificationContracts).toHaveLength(1);
    expect(report.sectionVerificationContracts[0].preservationChecks.join(' ')).toContain('diagnose');
    expect(report.sectionVerificationContracts[0].boundaryChecks.length).toBeGreaterThan(0);
  });

  it('packages verification readiness', () => {
    const report = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));

    expect(report.overallVerificationReadiness).toBeTruthy();
    expect(report.verificationEligibility).toBeTruthy();
    expect(report.verificationConfidence).toBeTruthy();
  });

  it('serializes compact verification contracts', () => {
    const report = buildExecutorVerificationContracts(buildVerificationInput(alignedHtml));
    const serialized = serializeExecutorVerificationContracts(report);

    expect(serialized).toContain('## EXECUTOR VERIFICATION CONTRACTS');
    expect(serialized).toContain('Verification readiness:');
    expect(serialized).toContain('Section verification contracts:');
    expect(serialized.length).toBeLessThan(1800);
  });
});
