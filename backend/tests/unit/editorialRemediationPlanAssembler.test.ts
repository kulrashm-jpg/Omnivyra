import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { observeBehavioralAdherenceDiagnostics } from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { buildEditorialQualityReadiness } from '../../../lib/content/editorialQualityReadiness';
import { buildEditorialQualitySignals } from '../../../lib/content/editorialQualitySignals';
import { observeEditorialDiagnostics } from '../../../lib/content/editorialDiagnosticObserver';
import {
  assembleEditorialRemediationPlan,
  serializeEditorialRemediationPlan,
} from '../../../lib/content/editorialRemediationPlanAssembler';
import { buildEditorialRemediationHints } from '../../../lib/content/editorialRemediationHints';
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

function buildPlanInput(contentHtml: string) {
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
    key_insights: ['Recovery planning should preserve workflow proof and reader-state movement.'],
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

  return {
    editorialRemediationHints,
    editorialQualityReadiness,
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
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

describe('editorialRemediationPlanAssembler', () => {
  it('generates deterministic remediation plans', () => {
    const first = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));
    const second = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-remediation-plan-v1');
    expect(first.overallRemediationStrategy.length).toBeGreaterThan(0);
  });

  it('orders recovery sequencing by priority and dependency', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(`
<h2>A</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>B</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>C</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
`));

    expect(plan.remediationExecutionOrder.length).toBeGreaterThan(0);
    expect(plan.remediationExecutionOrder[0].order).toBe(1);
    expect(plan.remediationExecutionOrder[0].priority).toBe('critical');
    expect(plan.remediationExecutionOrder.map((step) => step.order)).toEqual(
      plan.remediationExecutionOrder.map((_, index) => index + 1),
    );
  });

  it('builds a recovery priority map', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));

    expect(plan.recoveryPriorityMap.narrative).toBeTruthy();
    expect(plan.recoveryPriorityMap['anti-repetition']).toBeTruthy();
    expect(plan.recoveryPriorityMap.authority).toBeTruthy();
  });

  it('aggregates section recovery plans', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));

    expect(plan.sectionRecoveryPlans.length).toBeGreaterThan(0);
    expect(plan.sectionRecoveryPlans.every((section) => section.recoverySequence.length > 0)).toBe(true);
  });

  it('preserves narrative and anti-repetition recovery ordering', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(`
<h2>A</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>B</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>C</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
`));
    const antiRepetitionIndex = plan.remediationExecutionOrder.findIndex((step) => step.targetDimension === 'anti-repetition');
    const narrativeIndex = plan.remediationExecutionOrder.findIndex((step) => step.targetDimension === 'narrative');

    expect(antiRepetitionIndex).toBeGreaterThanOrEqual(0);
    expect(narrativeIndex).toBeGreaterThanOrEqual(0);
    expect(antiRepetitionIndex).toBeLessThan(narrativeIndex);
  });

  it('maps authority recovery plans', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));

    expect(plan.authorityRecoveryPlan.targetDimension).toBe('authority');
    expect(plan.authorityRecoveryPlan.recoveryStrategy).toContain('proof');
  });

  it('serializes compact recovery plans', () => {
    const plan = assembleEditorialRemediationPlan(buildPlanInput(alignedHtml));
    const serialized = serializeEditorialRemediationPlan(plan);

    expect(serialized).toContain('## EDITORIAL REMEDIATION PLAN');
    expect(serialized).toContain('Recovery confidence:');
    expect(serialized).toContain('Priority map:');
    expect(serialized.length).toBeLessThan(2500);
  });
});
