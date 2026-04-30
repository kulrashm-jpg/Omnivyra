import {
  buildSerpStructureHints,
  classifySearchIntent,
  expandTopicEntities,
  scoreLongFormContent,
} from '../../../lib/content/longFormSeoIntelligence';
import {
  buildDifferentiationStrategy,
  deriveContentPositioning,
  scoreDifferentiation,
  simulateCompetitorContentProfile,
} from '../../../lib/content/longFormDifferentiationIntelligence';
import {
  applyPerformanceToPositioning,
  derivePerformanceInsights,
  normalizePerformanceSignals,
  scoreContentPerformance,
  shouldTriggerPerformanceReoptimization,
} from '../../../lib/content/longFormPerformanceLearning';
import { evaluateLongFormContent } from '../../../lib/content/longFormContentEvaluator';
import type { ContentPlan, SectionGenerationResult } from '../../../lib/content/longFormPlanningEngine';

const basePlan: ContentPlan = {
  title: 'AI Content Strategy Framework',
  excerpt: 'A practical framework for evaluating AI content strategy.',
  key_insights: ['Use decision criteria before tooling.', 'Avoid generic AI content workflows.'],
  framework: {
    name: 'AI Content Strategy Readiness Framework',
    model_type: 'layers',
    components: ['Audience', 'Criteria', 'Execution', 'Proof'],
    section_title: 'The Framework',
  },
  faq: [
    { question: 'What is AI content strategy?', answer: 'AI content strategy is a structured way to plan, create, and evaluate content with AI support.' },
    { question: 'How do you apply AI content strategy?', answer: 'Start with audience needs, define criteria, then validate output quality.' },
    { question: 'Why does AI content strategy matter?', answer: 'It prevents generic output and improves decision quality.' },
    { question: 'What should teams avoid?', answer: 'Avoid using AI only to produce more undifferentiated content.' },
  ],
  evidence_plan: ['Use a workflow example.', 'Use a buyer decision scenario.'],
  sections: [
    {
      section_title: 'The Decision Trap',
      section_goal: 'Challenge the common approach.',
      unique_angle: 'Most teams optimize volume before criteria.',
      key_points: ['Decision criteria', 'Audience fit'],
      content_type: 'insight',
      depth_requirement: 'Be specific.',
      requires_direct_answer: true,
      requires_opinionated_insight: true,
      framework_role: 'none',
      target_entities: ['AI content strategy'],
    },
    {
      section_title: 'The Framework',
      section_goal: 'Introduce the model.',
      unique_angle: 'Make the model operational.',
      key_points: ['Framework layers', 'Execution order'],
      content_type: 'framework',
      depth_requirement: 'Explain components.',
      framework_role: 'introduce',
      target_entities: ['AI content strategy framework'],
    },
  ],
};

const strongSections: SectionGenerationResult[] = [
  {
    section_title: 'The Decision Trap',
    html: '<h2>The Decision Trap</h2><blockquote><strong>Direct answer:</strong> AI content strategy works when teams start with decision criteria.</blockquote><p>Most teams miss the tradeoff: more content creates more noise when there is no audience-specific evaluation model. For example, a SaaS team can publish fewer pieces but win more qualified searches by mapping each use case to buyer readiness.</p>',
  },
  {
    section_title: 'The Framework',
    html: '<h2>The Framework</h2><p>The AI Content Strategy Readiness Framework has four layers: Audience, Criteria, Execution, and Proof. The framework prevents vague advice by forcing every section to include a use case, failure mode, and decision signal.</p>',
  },
];

describe('long-form SEO and differentiation intelligence', () => {
  it('classifies comparison and commercial search intent from topic signals', () => {
    expect(classifySearchIntent({
      topic: 'HubSpot vs Salesforce for B2B SaaS',
      contentType: 'blog',
      formatType: 'comparison',
    })).toBe('comparison');

    expect(classifySearchIntent({
      topic: 'best AI content strategy tools',
      contentType: 'guide',
      formatType: 'comprehensive',
    })).toBe('commercial');
  });

  it('expands topic entities from topic, SEO context, and company context', () => {
    const entityMap = expandTopicEntities({
      topic: 'AI content strategy',
      contentType: 'guide',
      seoContext: 'semantic SEO, answer engine optimization',
      companyContext: {
        industry: 'B2B SaaS',
        audience: 'marketing leaders',
        authorityDomains: ['content operations'],
      },
    });

    expect(entityMap.primaryTopic).toBe('AI content strategy');
    expect(entityMap.relatedEntities).toEqual(expect.arrayContaining(['B2B SaaS', 'marketing leaders', 'content operations']));
    expect(entityMap.semanticVariations).toEqual(expect.arrayContaining(['what is AI content strategy']));
  });

  it('builds SERP hints that change for comparison intent', () => {
    const hints = buildSerpStructureHints('comparison');
    expect(hints.requiredStructures).toEqual(expect.arrayContaining(['comparison table', 'tradeoffs', 'verdict']));
    expect(hints.preferredSectionTypes).toEqual(expect.arrayContaining(['comparison']));
  });

  it('scores SEO, AEO, GEO, readability, and differentiation readiness', () => {
    const topicEntityMap = expandTopicEntities({
      topic: 'AI content strategy',
      contentType: 'guide',
      companyContext: { industry: 'B2B SaaS', audience: 'marketing leaders' },
    });
    const contentHtml = strongSections.map((section) => section.html).join('\n')
      + '<h2>FAQ</h2><h3>What is AI content strategy?</h3><p>It is a structured planning model.</p>';

    const { contentScore, improvementHooks } = scoreLongFormContent({
      plan: basePlan,
      sections: strongSections,
      contentHtml,
      contentBlocks: [{ type: 'paragraph', html: '<a href="/blog/ai-content">AI content</a>' }],
      contentType: 'guide',
      searchIntent: 'informational',
      topicEntityMap,
      companyContext: { industry: 'B2B SaaS', audience: 'marketing leaders' },
    });

    expect(contentScore.seo).toBeGreaterThanOrEqual(70);
    expect(contentScore.aeo).toBeGreaterThanOrEqual(70);
    expect(contentScore.geo).toBeGreaterThanOrEqual(70);
    expect(contentScore.overall).toBeGreaterThanOrEqual(70);
    expect(improvementHooks.missing_entities.length).toBeLessThanOrEqual(8);
  });

  it('derives positioning and rewards differentiated content', () => {
    const positioning = deriveContentPositioning({
      topic: 'AI content strategy myths',
      contentType: 'article',
      searchIntent: 'informational',
    });
    const competitorProfile = simulateCompetitorContentProfile({
      topic: 'AI content strategy myths',
      searchIntent: 'informational',
      positioning,
    });
    const differentiationStrategy = buildDifferentiationStrategy({
      topic: 'AI content strategy myths',
      positioning,
      competitorProfile,
      companyContext: { uniqueValue: 'operator-grade content systems' },
    });

    const result = scoreDifferentiation({
      plan: basePlan,
      sections: strongSections,
      positioning,
      competitorProfile,
      differentiationStrategy,
    });

    expect(positioning.primary).toBe('contrarian');
    expect(differentiationStrategy.avoid.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('derives performance insights from analytics-ready inputs', () => {
    const highPerformers = Array.from({ length: 8 }, (_, index) => ({
      content_id: `high-${index}`,
      impressions: 1200 + index,
      clicks: 100,
      avg_position: 4,
      dwell_time: 180,
      bounce_rate: 0.28,
      conversions: 7,
      content_age_days: 90,
      traffic_source: 'organic' as const,
    }));
    const insights = derivePerformanceInsights({
      performance: [
        ...highPerformers,
        {
          content_id: 'weak-1',
          impressions: 900,
          clicks: 3,
          avg_position: 28,
          dwell_time: 25,
          bounce_rate: 0.88,
          conversions: 0,
        },
      ],
      featureSnapshots: [
        ...highPerformers.map((item) => ({
          content_id: item.content_id,
          sectionTypes: ['framework', 'faq'],
          frameworks: ['Buyer Readiness Framework'],
          positioning: ['framework_first' as const],
          structures: ['step-by-step guide', 'FAQ'],
        })),
        {
          content_id: 'weak-1',
          sectionTypes: ['explanation'],
          frameworks: [],
          positioning: ['beginner_friendly'],
          structures: ['generic intro'],
          weakSections: ['generic intros'],
        },
      ],
    });

    expect(insights.highPerformingPatterns).toEqual(expect.arrayContaining(['framework', 'faq']));
    expect(insights.weakPatterns).toEqual(expect.arrayContaining(['beginner_friendly', 'generic intro']));
    expect(insights.winningSectionTypes).toEqual(expect.arrayContaining(['framework', 'faq']));
    expect(insights.scoringWeightAdjustments.aeo).toBeGreaterThan(0);
    expect(insights.scoringWeightAdjustments.geo).toBeGreaterThan(0);
    expect(insights.reoptimizationCandidates[0].content_id).toBe('weak-1');
  });

  it('lets performance learning influence positioning and re-optimization decisions', () => {
    const basePositioning = deriveContentPositioning({
      topic: 'AI content strategy',
      contentType: 'guide',
      searchIntent: 'informational',
    });
    const winners = Array.from({ length: 20 }, (_, index) => ({
      content_id: `winner-${index}`,
      impressions: 1000 + index,
      clicks: 90 + (index % 4),
      avg_position: 3,
      dwell_time: 185,
      bounce_rate: 0.24,
      conversions: 7,
      content_age_days: 60,
      traffic_source: 'organic' as const,
    }));
    const insights = derivePerformanceInsights({
      performance: winners,
      featureSnapshots: winners.map((winner, index) => ({
        content_id: winner.content_id,
        sectionTypes: ['comparison'],
        frameworks: ['Decision Matrix'],
        positioning: [index < 14 ? 'comparison_heavy' : 'framework_first'],
        structures: ['comparison table'],
        observed_at: new Date().toISOString(),
      })),
    });
    const adapted = applyPerformanceToPositioning(basePositioning, insights);
    const weakPerformance = {
      content_id: 'needs-work',
      impressions: 500,
      clicks: 2,
      avg_position: 31,
      dwell_time: 20,
      bounce_rate: 0.9,
      conversions: 0,
    };

    expect(adapted.primary).toBe('comparison_heavy');
    expect(insights.confidence).toBe('high');
    expect(scoreContentPerformance(weakPerformance)).toBeLessThan(50);
    expect(shouldTriggerPerformanceReoptimization(weakPerformance).shouldReoptimize).toBe(true);
  });

  it('normalizes volatile performance signals and limits low-confidence influence', () => {
    const metrics = normalizePerformanceSignals([
      {
        content_id: 'viral-spike',
        impressions: 100000,
        clicks: 20000,
        avg_position: 1,
        dwell_time: 300,
        bounce_rate: 0.05,
        conversions: 1200,
        content_age_days: 2,
        traffic_source: 'social',
        seasonality_index: 1.8,
      },
      {
        content_id: 'steady',
        impressions: 900,
        clicks: 60,
        avg_position: 6,
        dwell_time: 120,
        bounce_rate: 0.42,
        conversions: 3,
        content_age_days: 90,
        traffic_source: 'organic',
        seasonality_index: 1,
      },
    ]);
    const insights = derivePerformanceInsights({
      performance: [{
        content_id: 'tiny-sample',
        impressions: 1000,
        clicks: 100,
        avg_position: 2,
        dwell_time: 200,
        bounce_rate: 0.2,
        conversions: 8,
      }],
      featureSnapshots: [{
        content_id: 'tiny-sample',
        sectionTypes: ['faq'],
        frameworks: ['Decision Matrix'],
        positioning: ['comparison_heavy'],
        structures: ['FAQ'],
      }],
    });
    const basePositioning = deriveContentPositioning({
      topic: 'AI content strategy',
      contentType: 'guide',
      searchIntent: 'informational',
    });
    const adapted = applyPerformanceToPositioning(basePositioning, insights);

    expect(metrics.find((metric) => metric.content_id === 'viral-spike')?.adjustments.age).toBeLessThan(1);
    expect(insights.confidence).toBe('low');
    expect(insights.confidenceWeight).toBeLessThan(0.25);
    expect(insights.explorationRate).toBeGreaterThanOrEqual(0.4);
    expect(adapted.primary).toBe(basePositioning.primary);
  });

  it('evaluates long-form content across SEO, AEO, GEO, differentiation, and human quality', () => {
    const content = `
      <h2>The Decision Trap Most AI Content Strategies Miss</h2>
      <blockquote><strong>Direct answer:</strong> AI content strategy is the operating model that decides where AI should assist planning, drafting, validation, and optimization.</blockquote>
      <p>Most teams miss the tradeoff: volume without decision criteria creates more review work. For example, a B2B SaaS team can publish fewer pieces and still win more qualified searches by mapping every article to buyer readiness.</p>
      <h2>The AI Content Strategy Readiness Framework</h2>
      <p>The AI Content Strategy Readiness Framework has four layers: Audience, Criteria, Execution, and Proof. This framework gives teams a model for deciding when AI should generate, when humans should judge, and what evidence must be present.</p>
      <h2>How To Apply The Framework</h2>
      <p>Start with the audience problem, define decision criteria, create a workflow, and add proof checks. In practice, every section should include an example, a failure mode, and a measurable signal.</p>
      <h2>FAQ</h2>
      <h3>What is AI content strategy?</h3><p>AI content strategy is a structured system for using AI to plan, create, evaluate, and improve content.</p>
      <h3>How do teams apply AI content strategy?</h3><p>They define audience needs, map content to decisions, and validate output with examples and quality checks.</p>
      <h3>Why does AI content strategy matter?</h3><p>It prevents generic content and helps teams produce useful, differentiated assets.</p>
      <p><a href="/blog/content-operations">Related content operations guide</a></p>
    `;

    const result = evaluateLongFormContent({
      generatedContent: content,
      topic: 'AI content strategy',
      contentType: 'guide',
      targetIntent: 'informational',
      engineTrace: {
        searchIntent: 'informational',
        contentPositioning: { primary: 'framework_first', secondary: 'opinionated' },
        contentPlan: { framework: { name: 'AI Content Strategy Readiness Framework' } },
      },
    });

    expect(result.competitorSimulation).toHaveLength(3);
    expect(result.finalScorecard.seoScore).toBeGreaterThanOrEqual(6);
    expect(result.finalScorecard.aeoScore).toBeGreaterThanOrEqual(6);
    expect(result.finalScorecard.geoScore).toBeGreaterThanOrEqual(6);
    expect(result.improvementRecommendations.length).toBe(5);
  });

  it('flags generic weak content with shallow proof and low differentiation', () => {
    const result = evaluateLongFormContent({
      generatedContent: '<h2>Introduction</h2><p>In today\'s digital landscape, businesses need to unlock the power of AI content strategy. It is important to use AI for better results.</p><h2>Benefits</h2><p>AI can help teams save time and improve content. This is very useful for businesses.</p>',
      topic: 'AI content strategy',
      contentType: 'blog',
      targetIntent: 'informational',
    });

    expect(result.weaknesses.genericStatements).toEqual(expect.arrayContaining(['in today\'s digital landscape', 'it is important to', 'unlock the power']));
    expect(result.weaknesses.missingExamplesOrProof.length).toBeGreaterThan(0);
    expect(result.finalScorecard.differentiationScore).toBeLessThan(7);
  });

  it('returns the strict evaluator report contract used by engine_trace', () => {
    const result = evaluateLongFormContent({
      generatedContent: '<h2>What This Means</h2><p><strong>Direct answer:</strong> AI content strategy helps teams decide where AI should assist content work.</p><h2>Framework</h2><p>The AI Content Strategy Framework gives teams criteria, examples, and proof checks.</p><h2>FAQ</h2><h3>What is AI content strategy?</h3><p>It is a system for planning and improving AI-assisted content.</p>',
      topic: 'AI content strategy',
      contentType: 'blog',
      targetIntent: 'informational',
      engineTrace: {
        searchIntent: 'informational',
        contentPlan: { framework: { name: 'AI Content Strategy Framework' } },
      },
    });

    expect(result).toEqual(expect.objectContaining({
      competitorSimulation: expect.any(Array),
      comparativeAnalysis: expect.any(Object),
      scoreBreakdown: expect.any(Object),
      weaknesses: expect.any(Object),
      improvementRecommendations: expect.any(Array),
      finalScorecard: expect.any(Object),
    }));
    expect(result.finalScorecard).toEqual(expect.objectContaining({
      seoScore: expect.any(Number),
      aeoScore: expect.any(Number),
      geoScore: expect.any(Number),
      differentiationScore: expect.any(Number),
      clarity: expect.any(Number),
      depth: expect.any(Number),
      usefulness: expect.any(Number),
      authority: expect.any(Number),
    }));
  });
});
