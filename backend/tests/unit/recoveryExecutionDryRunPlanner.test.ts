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
import {
  planRecoveryExecutionDryRun,
  serializeRecoveryExecutionDryRun,
} from '../../../lib/content/recoveryExecutionDryRunPlanner';
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

function buildDryRunInput(contentHtml: string) {
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
    key_insights: ['Dry-run planning must preserve workflow proof and reader-state movement.'],
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

  return {
    regenerationExecutionManifest,
    regenerationCandidateSelection,
    regenerationReadinessContract,
    editorialRemediationPlan,
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

describe('recoveryExecutionDryRunPlanner', () => {
  it('generates deterministic dry-run plans', () => {
    const first = planRecoveryExecutionDryRun(buildDryRunInput(alignedHtml));
    const second = planRecoveryExecutionDryRun(buildDryRunInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('recovery-execution-dry-run-v1');
  });

  it('simulates execution order from the manifest', () => {
    const input = buildDryRunInput(alignedHtml);
    const plan = planRecoveryExecutionDryRun(input);

    expect(plan.dryRunExecutionOrder).toEqual(input.regenerationExecutionManifest.manifestExecutionOrder);
  });

  it('generates conflict and dependency signals', () => {
    const input = buildDryRunInput(alignedHtml);
    const firstCandidate = input.regenerationCandidateSelection.sectionRecoveryCandidates[0];
    const firstManifest = firstCandidate ? {
      sectionIndex: firstCandidate.sectionIndex,
      progressionStage: firstCandidate.progressionStage,
      narrativeRole: firstCandidate.narrativeRole,
      executionPriority: firstCandidate.priority,
      executionReadiness: 'conditional' as const,
      recoveryTargets: firstCandidate.recoveryTargets,
      rewriteBoundaries: [],
      preservationRequirements: firstCandidate.preservationRequirements,
      executionConstraints: ['non-executing dry-run test manifest'],
    } : undefined;
    const plan = planRecoveryExecutionDryRun({
      ...input,
      regenerationExecutionManifest: {
        ...input.regenerationExecutionManifest,
        sectionExecutionManifests: firstManifest ? [firstManifest] : [],
      },
    });

    expect(plan.simulatedConflictRisks).toContain('missing rewrite boundary');
    expect(plan.rewriteDependencySignals.length).toBeGreaterThan(0);
  });

  it('packages section dry-run plans', () => {
    const input = buildDryRunInput(alignedHtml);
    const firstCandidate = input.regenerationCandidateSelection.sectionRecoveryCandidates[0];
    const selectedCandidate = firstCandidate ? {
      ...firstCandidate,
      risk: 'low' as const,
      eligibility: 'eligible' as const,
    } : undefined;
    const firstManifest = selectedCandidate ? {
      sectionIndex: selectedCandidate.sectionIndex,
      progressionStage: selectedCandidate.progressionStage,
      narrativeRole: selectedCandidate.narrativeRole,
      executionPriority: selectedCandidate.priority,
      executionReadiness: 'conditional' as const,
      recoveryTargets: selectedCandidate.recoveryTargets,
      rewriteBoundaries: selectedCandidate.rewriteBoundaries,
      preservationRequirements: selectedCandidate.preservationRequirements,
      executionConstraints: ['non-executing dry-run test manifest'],
    } : undefined;
    const plan = planRecoveryExecutionDryRun({
      ...input,
      regenerationCandidateSelection: {
        ...input.regenerationCandidateSelection,
        sectionRecoveryCandidates: selectedCandidate ? [selectedCandidate] : [],
      },
      regenerationExecutionManifest: {
        ...input.regenerationExecutionManifest,
        sectionExecutionManifests: firstManifest ? [firstManifest] : [],
      },
    });

    expect(plan.sectionDryRunPlans.length).toBeGreaterThan(0);
    expect(plan.sectionDryRunPlans[0].preservationChecks.length).toBeGreaterThan(0);
  });

  it('simulates narrative and authority stability', () => {
    const plan = planRecoveryExecutionDryRun(buildDryRunInput(alignedHtml));

    expect(plan.narrativeStabilitySignals.join(' ')).toContain('diagnose');
    expect(plan.authorityStabilitySignals.join(' ')).toContain('evidence');
    expect(plan.antiRepetitionStabilitySignals.join(' ')).toContain('repeated');
  });

  it('serializes compact dry-run plans', () => {
    const plan = planRecoveryExecutionDryRun(buildDryRunInput(alignedHtml));
    const serialized = serializeRecoveryExecutionDryRun(plan);

    expect(serialized).toContain('## RECOVERY EXECUTION DRY RUN');
    expect(serialized).toContain('Dry-run readiness:');
    expect(serialized).toContain('Execution order:');
    expect(serialized.length).toBeLessThan(2000);
  });
});
