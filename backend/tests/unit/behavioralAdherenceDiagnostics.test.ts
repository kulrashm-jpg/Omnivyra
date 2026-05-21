import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import {
  observeBehavioralAdherenceDiagnostics,
  serializeBehavioralAdherenceDiagnostics,
} from '../../../lib/content/behavioralAdherenceDiagnostics';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
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

function buildDiagnosticInput(contentHtml: string) {
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

  return {
    generatedContent: {
      title: 'AI Content Operations',
      excerpt: 'A governed approach to content operations.',
      content_html: contentHtml,
      key_insights: ['Behavior must preserve workflow proof and reader-state movement.'],
    },
    generatorBehavioralSteering,
    generatorRuntimeAlignment,
    unifiedEditorialBrief,
    editorialRuntimeContext,
  };
}

const alignedHtml = `
<h2>Diagnose the operating tension</h2>
<p>Growth operators recognize AI content operations as a topic, but the real tension is that teams cannot connect campaign signals to daily execution decisions. The cause appears in workflow ownership, decision stakes, and the pain of unclear review loops.</p>
<h2>Reframe the default assumption</h2>
<p>The default assumption is that more content creates authority. Instead, SignalForge should reframe the work around workflow governance, closed-loop attribution, and an operator-first diagnosis of how decisions move from intelligence to execution.</p>
<h2>Expand the mechanism</h2>
<p>The mechanism is an execution intelligence loop. It separates insight, priority, proof, and publishing so the implication is causal rather than decorative, with each distinction changing how operators interpret the next decision.</p>
<h2>Operationalize the workflow</h2>
<p>The workflow should name an owner, decision point, review check, handoff, tradeoff, and constraint. That operating sequence shows how growth operators change what they approve, defer, stop, or measure.</p>
<h2>Validate the proof behavior</h2>
<p>Proof should be handled through evidence, scenario limits, constraints, and qualified claims. When verified metrics are unavailable, the recommendation should stay bounded rather than pretending every outcome has been proven.</p>
<h2>Resolve the operating implication</h2>
<p>Ultimately, the operating implication is that governed generation only compounds when strategic tension, workflow realism, proof boundaries, and authority discipline stay connected.</p>
`;

describe('behavioralAdherenceDiagnostics', () => {
  it('generates deterministic behavioral diagnostics', () => {
    const first = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));
    const second = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('behavioral-adherence-diagnostics-v1');
    expect(first.sections).toHaveLength(6);
  });

  it('detects behavioral drift from generic repeated sections', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(`
<h2>A</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations that avoid workflow, proof, operators, and decision constraints.</p>
<h2>B</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations that avoid workflow, proof, operators, and decision constraints.</p>
<h2>C</h2><p>This section gives an overview of best practices and innovative ways to drive growth with generic recommendations that avoid workflow, proof, operators, and decision constraints.</p>
`));

    expect(report.driftIndicators.repeatedBehavioralPatterns).toBe(true);
    expect(report.driftIndicators.genericStrategicFraming).toBe(true);
    expect(report.sections.some((section) => section.antiRepetitionBehaviorAlignment.risk === 'high')).toBe(true);
  });

  it('observes authority behavior', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));

    expect(report.sections[4].authorityBehaviorAlignment.aligned).toBe(true);
    expect(report.sections[4].claimQualificationBehaviorAlignment.aligned).toBe(true);
  });

  it('observes operational realism behavior', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));
    const operationalize = report.sections.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.operationalRealismBehaviorAlignment.aligned).toBe(true);
    expect(operationalize?.operationalRealismBehaviorAlignment.indicators.join(' ')).toContain('operational marker count');
  });

  it('observes anti-repetition and reader-state behavior', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));

    expect(report.driftIndicators.repeatedBehavioralPatterns).toBe(false);
    expect(report.sections[0].readerStateBehaviorAlignment.aligned).toBe(true);
    expect(report.sections[0].antiRepetitionBehaviorAlignment.risk).not.toBe('high');
  });

  it('detects audience behavior drift when audience/operator cues are absent', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(`
<h2>Overview</h2><p>Content can be useful when people publish more often and follow simple tips.</p>
<h2>More</h2><p>Writing can improve when content is clear and easy to read.</p>
`));

    expect(report.driftIndicators.audienceSophisticationDrift).toBe(true);
    expect(report.sections.some((section) => section.audienceBehaviorAlignment.aligned === false)).toBe(true);
  });

  it('serializes compact behavioral diagnostics', () => {
    const report = observeBehavioralAdherenceDiagnostics(buildDiagnosticInput(alignedHtml));
    const serialized = serializeBehavioralAdherenceDiagnostics(report);

    expect(serialized).toContain('## BEHAVIORAL ADHERENCE DIAGNOSTICS');
    expect(serialized).toContain('Overall risk:');
    expect(serialized).toContain('Section behavioral observations:');
    expect(serialized.length).toBeLessThan(3000);
  });
});
