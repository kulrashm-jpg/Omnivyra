import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import {
  buildEditorialDepthIntelligence,
  serializeEditorialDepthIntelligence,
} from '../../../lib/content/editorialDepthIntelligence';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
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

function buildDepth(overrides: { companyContext?: typeof companyContext | Record<string, never>; sectionCount?: number } = {}) {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(overrides.companyContext ?? companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount: overrides.sectionCount ?? 6,
  });
  const generationGuidance = buildGenerationGuidanceContract({ doctrine, assimilation, narrativePlanning });
  const depth = buildEditorialDepthIntelligence({
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
  });
  return { doctrine, assimilation, narrativePlanning, generationGuidance, depth };
}

describe('editorialDepthIntelligence', () => {
  it('generates deterministic structured depth primitives', () => {
    const first = buildDepth().depth;
    const second = buildDepth().depth;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-depth-intelligence-v1');
    expect(first.sections).toHaveLength(6);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);

    for (const section of first.sections) {
      expect(section.operationalNuanceTargets.length).toBeGreaterThan(0);
      expect(section.tradeoffExpectations.length).toBeGreaterThan(0);
      expect(section.implementationFrictionSignals.length).toBeGreaterThan(0);
      expect(section.stakeholderComplexitySignals.length).toBeGreaterThan(0);
      expect(section.maturityStageSignals.length).toBeGreaterThan(0);
      expect(section.proofDepthExpectations.length).toBeGreaterThan(0);
      expect(section.workflowRealismTargets.length).toBeGreaterThan(0);
      expect(section.decisionImpactSignals.length).toBeGreaterThan(0);
      expect(section.misconceptionTargets.length).toBeGreaterThan(0);
      expect(section.strategicTensionSignals.length).toBeGreaterThan(0);
      expect(section.beforeAfterStateTargets.length).toBeGreaterThan(0);
      expect(section.failurePatternTargets.length).toBeGreaterThan(0);
    }
  });

  it('maps narrative stages to tradeoff and depth behavior', () => {
    const { depth } = buildDepth();
    const diagnose = depth.sections.find((section) => section.progressionStage === 'diagnose');
    const operationalize = depth.sections.find((section) => section.progressionStage === 'operationalize');
    const validate = depth.sections.find((section) => section.progressionStage === 'validate');

    expect(diagnose?.tradeoffExpectations.join(' ')).toContain('speed of action versus accuracy of diagnosis');
    expect(operationalize?.tradeoffExpectations.join(' ')).toContain('governance versus speed');
    expect(validate?.proofDepthExpectations.join(' ')).toContain('evidence');
  });

  it('generates workflow realism and implementation friction from assimilation', () => {
    const { depth } = buildDepth();
    const operationalize = depth.sections.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.workflowRealismTargets.join(' ')).toContain('decision points');
    expect(operationalize?.workflowRealismTargets.join(' ')).toContain('Treat teams cannot connect campaign signals');
    expect(operationalize?.implementationFrictionSignals.join(' ')).toContain('teams cannot connect campaign signals');
  });

  it('assigns maturity-aware expectations from company context completeness', () => {
    const rich = buildDepth().depth;
    const sparse = buildDepth({ companyContext: {} }).depth;

    expect(rich.maturityStage).toBe('advanced');
    expect(rich.sections[0].maturityStageSignals.join(' ')).toContain('second-order consequences');
    expect(sparse.maturityStage).toBe('foundational');
    expect(sparse.sections[0].maturityStageSignals.join(' ')).toContain('define operating concepts');
  });

  it('maps doctrine beliefs into strategic tension targets', () => {
    const { doctrine, depth } = buildDepth();

    expect(depth.sections[0].strategicTensionSignals.join(' ')).toContain(doctrine.strategicBeliefs[0]);
    expect(depth.sections[1].misconceptionTargets.join(' ')).toContain('in today\'s fast-paced digital landscape');
  });

  it('maps assimilation primitives into before-after and authority depth', () => {
    const { depth } = buildDepth();
    const first = depth.sections[0];

    expect(first.beforeAfterStateTargets.join(' ')).toContain('teams cannot connect campaign signals');
    expect(first.beforeAfterStateTargets.join(' ')).toContain('governed execution intelligence');
    expect(first.decisionImpactSignals.join(' ')).toContain('SignalForge has authority');
  });

  it('serializes compact generation-safe depth context', () => {
    const { depth } = buildDepth();
    const serialized = serializeEditorialDepthIntelligence(depth);

    expect(serialized).toContain('## EDITORIAL DEPTH INTELLIGENCE');
    expect(serialized).toContain('Version: editorial-depth-intelligence-v1');
    expect(serialized).toContain('Section depth primitives:');
    expect(serialized).toContain('diagnose/problem_diagnosis');
    expect(serialized.length).toBeLessThan(6500);
  });

  it('integrates depth intelligence into generation context and prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.editorialDepth.version).toBe('editorial-depth-intelligence-v1');
    expect(context.editorialDepth.sections).toHaveLength(5);
    expect(promptContext).toContain('## EDITORIAL DEPTH INTELLIGENCE');
    expect(promptContext).toContain('Global depth expectations:');
    expect(promptContext).toContain('Section depth primitives:');
  });
});
