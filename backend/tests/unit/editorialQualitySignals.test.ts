import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import {
  observeBehavioralAdherenceDiagnostics,
} from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import {
  buildEditorialQualitySignals,
  serializeEditorialQualitySignals,
} from '../../../lib/content/editorialQualitySignals';
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

function buildQualityInput(contentHtml: string) {
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
    key_insights: ['Quality signals should preserve workflow proof and reader-state movement.'],
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

  return {
    editorialDiagnostics,
    behavioralAdherenceDiagnostics,
    generatorBehavioralSteering,
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

describe('editorialQualitySignals', () => {
  it('generates deterministic normalized quality signals', () => {
    const first = buildEditorialQualitySignals(buildQualityInput(alignedHtml));
    const second = buildEditorialQualitySignals(buildQualityInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-quality-signals-v1');
    expect(first.sectionQualitySignals).toHaveLength(6);
  });

  it('normalizes duplicate risk indicators across diagnostics', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(`
<h2>A</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>B</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
<h2>C</h2><p>In short, the answer is best practices and innovative ways to leverage content and drive growth.</p>
`));

    expect(new Set(report.editorialRiskSignals).size).toBe(report.editorialRiskSignals.length);
    expect(report.editorialRiskSignals).toContain('repeatedDirectAnswerShape');
    expect(report.editorialRiskSignals).toContain('genericStrategicFraming');
  });

  it('aggregates section-level quality tendencies', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(alignedHtml));

    expect(report.sectionQualitySignals[0].alignedDimensions).toBeGreaterThan(0);
    expect(report.sectionQualitySignals[0].totalDimensions).toBeGreaterThan(report.sectionQualitySignals[0].alignedDimensions - 1);
    expect(report.sectionQualitySignals.every((section) => section.progressionStage)).toBe(true);
  });

  it('maps behavioral consistency from steering and runtime alignment', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(alignedHtml));

    expect(report.behavioralConsistencySignals.sourceDimensions).toContain('behavioralPriorityAlignment');
    expect(report.behavioralConsistencySignals.indicators.length).toBeGreaterThan(0);
  });

  it('generates anti-repetition quality signals', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(`
<h2>A</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>B</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
<h2>C</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations.</p>
`));

    expect(report.antiRepetitionSignals.risk).toBe('high');
    expect(report.antiRepetitionSignals.riskIndicators.join(' ')).toContain('repeated');
  });

  it('maps authority quality and operational realism signals', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(alignedHtml));

    expect(report.authorityQualitySignals.sourceDimensions).toContain('authorityBehaviorAlignment');
    expect(report.operationalRealismSignals.sourceDimensions).toContain('operationalRealismBehaviorAlignment');
    expect(report.operationalRealismSignals.indicators.join(' ')).toContain('operational marker count');
  });

  it('serializes compact editorial quality signals', () => {
    const report = buildEditorialQualitySignals(buildQualityInput(alignedHtml));
    const serialized = serializeEditorialQualitySignals(report);

    expect(serialized).toContain('## EDITORIAL QUALITY SIGNALS');
    expect(serialized).toContain('Overall risk:');
    expect(serialized).toContain('Signal summary:');
    expect(serialized.length).toBeLessThan(2500);
  });
});
