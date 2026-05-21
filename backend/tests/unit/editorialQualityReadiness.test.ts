import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { observeBehavioralAdherenceDiagnostics } from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import {
  buildEditorialQualityReadiness,
  serializeEditorialQualityReadiness,
} from '../../../lib/content/editorialQualityReadiness';
import { buildEditorialQualitySignals } from '../../../lib/content/editorialQualitySignals';
import { observeEditorialDiagnostics } from '../../../lib/content/editorialDiagnosticObserver';
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

function buildReadinessInput(contentHtml: string) {
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
    key_insights: ['Readiness should preserve workflow proof and reader-state movement.'],
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

  return {
    editorialQualitySignals,
    behavioralAdherenceDiagnostics,
    editorialDiagnostics,
    generatorRuntimeAlignment,
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

describe('editorialQualityReadiness', () => {
  it('generates deterministic readiness outputs', () => {
    const first = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));
    const second = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-quality-readiness-v1');
    expect(first.sectionReadiness).toHaveLength(6);
  });

  it('interprets readiness tiers consistently from quality signals', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));

    expect(['strong', 'ready', 'developing', 'at_risk', 'not_ready']).toContain(report.overallReadinessTier);
    expect(report.narrativeReadiness.tier).toBeTruthy();
    expect(report.readinessConfidence).toBeTruthy();
  });

  it('aggregates section readiness context', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));

    expect(report.sectionReadiness[0].alignedDimensions).toBeGreaterThan(0);
    expect(report.sectionReadiness[0].totalDimensions).toBeGreaterThan(0);
    expect(report.sectionReadiness.every((section) => section.readinessConfidence)).toBe(true);
  });

  it('maps high risk into risk readiness', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(`
<h2>A</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>B</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>C</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
`));

    expect(['at_risk', 'not_ready']).toContain(report.editorialRiskReadiness.tier);
    expect(report.editorialRiskReadiness.blockingRisks.length).toBeGreaterThan(0);
  });

  it('interprets behavioral consistency readiness', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));

    expect(report.behavioralConsistencyReadiness.supportingSignals.length).toBeGreaterThan(0);
    expect(report.behavioralConsistencyReadiness.riskLevel).toBeTruthy();
  });

  it('maps authority and anti-repetition readiness', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(`
<h2>A</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>B</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>C</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
`));

    expect(report.authorityReadiness.tier).toBeTruthy();
    expect(report.antiRepetitionReadiness.tier).toBe('not_ready');
    expect(report.antiRepetitionReadiness.blockingRisks.join(' ')).toContain('repeated');
  });

  it('serializes compact readiness context', () => {
    const report = buildEditorialQualityReadiness(buildReadinessInput(alignedHtml));
    const serialized = serializeEditorialQualityReadiness(report);

    expect(serialized).toContain('## EDITORIAL QUALITY READINESS');
    expect(serialized).toContain('Overall readiness:');
    expect(serialized).toContain('Readiness dimensions:');
    expect(serialized.length).toBeLessThan(2500);
  });
});
