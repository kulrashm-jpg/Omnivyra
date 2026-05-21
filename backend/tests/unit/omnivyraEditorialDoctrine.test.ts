import {
  getOmnivyraEditorialDoctrine,
  resolveOmnivyraDoctrineGenerationContext,
} from '../../../lib/content/omnivyraEditorialDoctrine';
import {
  buildGenerationContext,
  buildUnifiedPromptContext,
} from '../../../lib/content/contentGenerationOrchestrator';

jest.mock('../../../lib/blog/seoIntelligenceEngine', () => ({
  getSEOIntelligence: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../lib/blog/feedbackOptimizationEngine', () => ({
  getFeedbackOptimization: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../lib/blog/trendIntelligenceEngine', () => ({
  getTrendIntelligence: jest.fn().mockResolvedValue(null),
}));

describe('omnivyraEditorialDoctrine', () => {
  it('resolves the canonical doctrine with required structured primitives', () => {
    const doctrine = getOmnivyraEditorialDoctrine();

    expect(doctrine.id).toBe('omnivyra-editorial-doctrine');
    expect(doctrine.worldview.thesis).toContain('intelligence');
    expect(doctrine.categoryNarrative.category).toBe('marketing intelligence and execution systems');
    expect(doctrine.strategicBeliefs.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.enemyAssumptions.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.preferredAnalyticalPatterns.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.approvedPovArchetypes.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.forbiddenGenericFraming.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.preferredTerminology).toContain('editorial intelligence');
    expect(doctrine.proprietaryConcepts.some((concept) => concept.id === 'authority_architecture')).toBe(true);
    expect(doctrine.operationalPhilosophy.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.proofStandards.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.authorityPosture.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.toneConstraints.length).toBeGreaterThanOrEqual(5);
    expect(doctrine.audienceSophisticationExpectations.length).toBeGreaterThanOrEqual(5);
  });

  it('is deeply immutable at runtime', () => {
    const doctrine = getOmnivyraEditorialDoctrine();

    expect(Object.isFrozen(doctrine)).toBe(true);
    expect(Object.isFrozen(doctrine.worldview)).toBe(true);
    expect(Object.isFrozen(doctrine.strategicBeliefs)).toBe(true);
    expect(Object.isFrozen(doctrine.approvedPovArchetypes[0])).toBe(true);

    expect(() => {
      (doctrine.strategicBeliefs as string[]).push('mutated belief');
    }).toThrow();
  });

  it('loads deterministically without environment-dependent mutation', () => {
    const first = getOmnivyraEditorialDoctrine();
    const second = getOmnivyraEditorialDoctrine();
    const firstContext = resolveOmnivyraDoctrineGenerationContext();
    const secondContext = resolveOmnivyraDoctrineGenerationContext();

    expect(first).toBe(second);
    expect(JSON.stringify(firstContext)).toBe(JSON.stringify(secondContext));
    expect(firstContext.worldview).toBe(first.worldview);
    expect(secondContext.strategicBeliefs).toBe(first.strategicBeliefs);
  });

  it('exposes forbidden framing and approved POV availability', () => {
    const context = resolveOmnivyraDoctrineGenerationContext();

    expect(context.forbiddenGenericFraming).toContain('in today\'s fast-paced digital landscape');
    expect(context.approvedPovArchetypes.map((pov) => pov.id)).toEqual(
      expect.arrayContaining(['operator_first', 'systems_over_outputs', 'workflow_realism']),
    );
  });

  it('adds doctrine presence to generation context', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content strategy',
      companyId: 'company-1',
      targetWordCount: 1200,
    });

    expect(context.doctrine.worldview.thesis).toContain('operating system');
    expect(context.doctrine.strategicBeliefs.length).toBeGreaterThan(0);
    expect(context.doctrine.forbiddenGenericFraming.length).toBeGreaterThan(0);
    expect(context.doctrine.approvedPovArchetypes.length).toBeGreaterThan(0);
  });

  it('renders doctrine presence in the unified generation context', async () => {
    const context = await buildGenerationContext({
      contentType: 'article',
      topic: 'marketing intelligence',
      companyId: 'company-1',
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(promptContext).toContain('## OMNIVYRA EDITORIAL DOCTRINE');
    expect(promptContext).toContain('Worldview:');
    expect(promptContext).toContain('Strategic beliefs:');
    expect(promptContext).toContain('Forbidden framing:');
    expect(promptContext).toContain('Approved POV patterns:');
  });
});

