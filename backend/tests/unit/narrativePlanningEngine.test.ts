import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import { buildGenerationContext, buildUnifiedPromptContext } from '../../../lib/content/contentGenerationOrchestrator';

jest.mock('../../../lib/blog/seoIntelligenceEngine', () => ({
  getSEOIntelligence: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../lib/blog/feedbackOptimizationEngine', () => ({
  getFeedbackOptimization: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../lib/blog/trendIntelligenceEngine', () => ({
  getTrendIntelligence: jest.fn().mockResolvedValue(null),
}));

const companyContext = {
  companyName: 'SignalForge',
  audience: 'growth operators',
  industry: 'marketing intelligence',
  coreProblemStatement: 'teams cannot connect campaign signals to daily execution decisions',
  uniqueValue: 'turns marketing signals into governed execution choices',
  competitiveAdvantages: 'workflow governance; closed-loop attribution',
  productsServices: 'an AI marketing intelligence workspace',
  authorityDomains: ['marketing intelligence', 'content operations'],
  desiredTransformation: 'from scattered campaign activity to governed execution intelligence',
};

function buildPlan(sectionCount = 6) {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  return buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount,
  });
}

describe('narrativePlanningEngine', () => {
  it('assigns required narrative stage sequencing', () => {
    const plan = buildPlan(6);

    expect(plan.progressionStages).toEqual([
      'diagnose',
      'reframe',
      'expand',
      'operationalize',
      'validate',
      'resolve',
    ]);
    expect(plan.sections.map((section) => section.progressionStage)).toEqual(plan.progressionStages);
  });

  it('assigns unique section roles across the progression', () => {
    const plan = buildPlan(6);
    const roles = plan.sections.map((section) => section.narrativeRole);

    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).toEqual(expect.arrayContaining([
      'problem_diagnosis',
      'belief_reframe',
      'concept_expansion',
      'operating_translation',
      'proof_validation',
      'strategic_resolution',
    ]));
  });

  it('generates redundancy boundaries for each section', () => {
    const plan = buildPlan(5);

    expect(plan.antiRepetitionRules.length).toBeGreaterThanOrEqual(5);
    for (const section of plan.sections) {
      expect(section.redundancyBoundary).toContain('Do not reuse');
      expect(section.redundancyBoundary).toContain(section.narrativeRole);
    }
  });

  it('creates reader-state progression across sections', () => {
    const plan = buildPlan(6);

    expect(plan.sections[0].readerStateShift.from).toContain('recognizing AI content operations');
    expect(plan.sections[0].readerStateShift.to).toContain('operating tension');
    expect(plan.sections[plan.sections.length - 1].readerStateShift.to).toContain('strategic operating implication');
    expect(new Set(plan.sections.map((section) => section.readerStateShift.to)).size).toBe(plan.sections.length);
  });

  it('returns deterministic planning outputs', () => {
    const first = buildPlan(6);
    const second = buildPlan(6);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);
  });

  it('uses doctrine beliefs in insight expectations', () => {
    const plan = buildPlan(6);

    expect(plan.sections.find((section) => section.progressionStage === 'reframe')?.insightExpectation)
      .toContain('Generic content is usually a symptom');
  });

  it('uses assimilation primitives in narrative purposes and proof expectations', () => {
    const plan = buildPlan(6);

    expect(plan.sections[0].sectionPurpose).toContain('campaign signals');
    expect(plan.sections[1].sectionPurpose).toContain('workflow governance');
    expect(plan.sections.find((section) => section.progressionStage === 'validate')?.proofExpectation)
      .toContain('concrete scenarios');
  });

  it('maintains multi-section progression consistency for shorter plans', () => {
    const plan = buildPlan(4);

    expect(plan.progressionStages).toEqual(['diagnose', 'reframe', 'operationalize', 'resolve']);
    expect(plan.sections).toHaveLength(4);
    expect(plan.sections[2].transitionObjective).toContain('resolve');
    expect(plan.sections[3].transitionObjective).toContain('Close the argument');
  });

  it('integrates narrative planning into generation context only', async () => {
    const context = await buildGenerationContext({
      contentType: 'guide',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.narrativePlanning.version).toBe('narrative-planning-v1');
    expect(context.narrativePlanning.sections).toHaveLength(5);
    expect(promptContext).toContain('## NARRATIVE PLANNING PRIMITIVES');
    expect(promptContext).toContain('Progression stages: diagnose -> reframe -> expand -> operationalize -> resolve');
  });
});

