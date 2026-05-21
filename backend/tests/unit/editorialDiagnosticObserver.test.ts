import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import {
  observeEditorialDiagnostics,
  serializeEditorialDiagnosticReport,
} from '../../../lib/content/editorialDiagnosticObserver';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';

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
  const generationGuidance = buildGenerationGuidanceContract({
    doctrine,
    assimilation,
    narrativePlanning,
  });

  return {
    generatedContent: {
      title: 'AI Content Operations',
      excerpt: 'A governed approach to content operations.',
      content_html: contentHtml,
      key_insights: ['Editorial authority requires workflow proof.'],
    },
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  };
}

const alignedHtml = `
<h2>Diagnose the operating tension</h2>
<p>Growth operators feel the pain when teams cannot connect campaign signals to daily execution decisions. The hidden cause is not writing quality; the problem is weak upstream context, unclear workflow ownership, and stakes that never reach the content brief.</p>
<h2>Reframe the default assumption</h2>
<p>The default assumption is that more articles create authority. Instead, SignalForge should reframe AI content operations around workflow governance, closed-loop attribution, and the belief that generic content is a symptom of weak upstream context.</p>
<h2>Expand the mechanism</h2>
<p>The mechanism is an execution intelligence loop. Intelligence becomes decisions, assets, schedules, and learning loops when distinctions between insight, priority, proof, and publishing are made explicit.</p>
<h2>Operationalize the workflow</h2>
<p>The workflow decision is practical: assign an owner, set a quality check, name the tradeoff, and define the success signal before production starts. That process changes how operators prioritize content and review output.</p>
<h2>Validate with proof behavior</h2>
<p>Proof should appear through a concrete scenario, evidence signals, constraints, and examples from marketing intelligence work. When verified data is unavailable, the claim should be qualified rather than inflated.</p>
<h2>Resolve the operating implication</h2>
<p>Ultimately, the operating implication is that governed generation compounds only when editorial intelligence, proof mechanics, semantic authority, and workflow realism stay connected.</p>
`;

describe('editorialDiagnosticObserver', () => {
  it('generates deterministic structured diagnostics', () => {
    const first = observeEditorialDiagnostics(buildObserverInput(alignedHtml));
    const second = observeEditorialDiagnostics(buildObserverInput(alignedHtml));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-diagnostic-observer-v1');
    expect(first.sections).toHaveLength(6);
  });

  it('detects repetition risk from repeated direct-answer shapes', () => {
    const repeated = `
<h2>One</h2><p>In short, the answer is better workflow. In short, the answer is better workflow.</p>
<h2>Two</h2><p>In short, the answer is better workflow. In short, the answer is better workflow.</p>
<h2>Three</h2><p>In short, the answer is better workflow.</p>
`;
    const report = observeEditorialDiagnostics(buildObserverInput(repeated));

    expect(report.driftIndicators.repeatedDirectAnswerShape).toBe(true);
    expect(report.sections.some((section) => section.repetitionRisk.risk === 'high')).toBe(true);
  });

  it('detects generic framing risk', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(`
<h2>Generic</h2>
<p>In today's fast-paced digital landscape, businesses need to leverage innovative solutions to unlock the full potential of your content strategy and drive growth with actionable insights.</p>
`));

    expect(report.driftIndicators.genericSaasFraming).toBe(true);
    expect(report.sections[0].genericFramingRisk.risk).toBe('high');
  });

  it('observes narrative-stage alignment', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(alignedHtml));

    expect(report.sections[0].narrativeStageAlignment.aligned).toBe(true);
    expect(report.sections[0].narrativeStageAlignment.indicators.join(' ')).toContain('stage marker count');
  });

  it('detects doctrine drift when doctrine POV is absent and forbidden framing is present', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(`
<h2>Overview</h2>
<p>Best practices for success help businesses streamline workflow for better results with cutting-edge tools.</p>
`));

    expect(report.driftIndicators.doctrineDrift).toBe(true);
    expect(report.sections[0].doctrineAlignment.risk).toBe('high');
  });

  it('detects assimilation drift when company primitives are absent', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(`
<h2>Overview</h2>
<p>This article explains writing in broad terms. People should write clearly, publish often, and measure performance over time.</p>
`));

    expect(report.driftIndicators.assimilationDrift).toBe(true);
    expect(report.sections.some((section) => section.assimilationAlignment.aligned === false)).toBe(true);
  });

  it('observes reader-state movement', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(alignedHtml));

    expect(report.sections[0].readerStateProgression.aligned).toBe(true);
    expect(report.sections[0].readerStateProgression.risk).toBe('low');
  });

  it('observes section differentiation risk', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(`
<h2>A</h2><p>This section gives an overview.</p>
<h2>B</h2><p>This section gives another overview.</p>
<h2>C</h2><p>This section gives another overview.</p>
`));

    expect(report.driftIndicators.weakPovDifferentiation).toBe(true);
    expect(report.sections.some((section) => section.sectionDifferentiationAlignment.aligned === false)).toBe(true);
  });

  it('serializes compact diagnostic context', () => {
    const report = observeEditorialDiagnostics(buildObserverInput(alignedHtml));
    const serialized = serializeEditorialDiagnosticReport(report);

    expect(serialized).toContain('## EDITORIAL DIAGNOSTIC OBSERVER');
    expect(serialized).toContain('Overall risk:');
    expect(serialized).toContain('Section observations:');
    expect(serialized.length).toBeLessThan(2500);
  });
});
