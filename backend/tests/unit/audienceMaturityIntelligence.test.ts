import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import {
  buildAudienceMaturityIntelligence,
  serializeAudienceMaturityIntelligence,
} from '../../../lib/content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
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

function buildMaturity(overrides: { companyContext?: typeof companyContext | Record<string, never>; sectionCount?: number } = {}) {
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
  return { doctrine, assimilation, narrativePlanning, generationGuidance, editorialDepth, editorialAuthority, audienceMaturity };
}

describe('audienceMaturityIntelligence', () => {
  it('generates deterministic structured maturity primitives', () => {
    const first = buildMaturity().audienceMaturity;
    const second = buildMaturity().audienceMaturity;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('audience-maturity-intelligence-v1');
    expect(first.sections).toHaveLength(6);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);

    for (const section of first.sections) {
      expect(section.audienceSophisticationLevel).toBeTruthy();
      expect(section.operationalFamiliarityTargets.length).toBeGreaterThan(0);
      expect(section.decisionMakerExpectations.length).toBeGreaterThan(0);
      expect(section.knowledgeAssumptionBoundaries.length).toBeGreaterThan(0);
      expect(section.terminologyComplexityTargets.length).toBeGreaterThan(0);
      expect(section.strategicDepthTargets.length).toBeGreaterThan(0);
      expect(section.implementationDetailExpectations.length).toBeGreaterThan(0);
      expect(section.proofSophisticationTargets.length).toBeGreaterThan(0);
      expect(section.objectionComplexityTargets.length).toBeGreaterThan(0);
      expect(section.stakeholderAwarenessTargets.length).toBeGreaterThan(0);
      expect(section.changeResistanceSignals.length).toBeGreaterThan(0);
      expect(section.executiveVsOperatorBalance.length).toBeGreaterThan(0);
    }
  });

  it('maps maturity stages to audience sophistication levels', () => {
    const rich = buildMaturity().audienceMaturity;
    const sparse = buildMaturity({ companyContext: {} }).audienceMaturity;

    expect(rich.audienceSophisticationLevel).toBe('executive-practitioner');
    expect(rich.globalMaturityExpectations.join(' ')).toContain('strategic accountability');
    expect(sparse.audienceSophisticationLevel).toBe('foundational');
    expect(sparse.globalMaturityExpectations.join(' ')).toContain('make core operating concepts explicit');
  });

  it('generates knowledge boundaries by narrative stage', () => {
    const { audienceMaturity } = buildMaturity();
    const diagnose = audienceMaturity.sections.find((section) => section.progressionStage === 'diagnose');
    const validate = audienceMaturity.sections.find((section) => section.progressionStage === 'validate');

    expect(diagnose?.knowledgeAssumptionBoundaries.join(' ')).toContain('do not over-explain the category');
    expect(validate?.knowledgeAssumptionBoundaries.join(' ')).toContain('clarify what can and cannot be proven');
  });

  it('calibrates decision-maker expectations from assimilation', () => {
    const { audienceMaturity } = buildMaturity();
    const reframe = audienceMaturity.sections.find((section) => section.progressionStage === 'reframe');

    expect(reframe?.decisionMakerExpectations.join(' ')).toContain('choosing which belief will govern execution');
    expect(reframe?.decisionMakerExpectations.join(' ')).toContain('growth operators faces pressure');
  });

  it('balances operator and executive expectations by section role', () => {
    const { audienceMaturity } = buildMaturity();
    const operationalize = audienceMaturity.sections.find((section) => section.progressionStage === 'operationalize');
    const resolve = audienceMaturity.sections.find((section) => section.progressionStage === 'resolve');

    expect(operationalize?.executiveVsOperatorBalance.join(' ')).toContain('strategic consequence');
    expect(operationalize?.executiveVsOperatorBalance.join(' ')).toContain('operator-heavy detail');
    expect(resolve?.executiveVsOperatorBalance.join(' ')).toContain('executive-level synthesis');
  });

  it('maps terminology complexity through doctrine and company primitives', () => {
    const { doctrine, audienceMaturity } = buildMaturity();
    const expand = audienceMaturity.sections.find((section) => section.progressionStage === 'expand');

    expect(expand?.terminologyComplexityTargets.join(' ')).toContain('technical or strategic terms');
    expect(expand?.terminologyComplexityTargets.join(' ')).toContain('workflow governance');
    expect(expand?.terminologyComplexityTargets.join(' ')).toContain(doctrine.strategicBeliefs[0]);
  });

  it('maps proof sophistication from authority and depth intelligence', () => {
    const { audienceMaturity } = buildMaturity();
    const validate = audienceMaturity.sections.find((section) => section.progressionStage === 'validate');

    expect(validate?.proofSophisticationTargets.join(' ')).toContain('sourced facts');
    expect(validate?.proofSophisticationTargets.join(' ')).toContain('executive-level decision impact');
  });

  it('serializes compact generation-safe maturity context', () => {
    const { audienceMaturity } = buildMaturity();
    const serialized = serializeAudienceMaturityIntelligence(audienceMaturity);

    expect(serialized).toContain('## AUDIENCE MATURITY INTELLIGENCE');
    expect(serialized).toContain('Version: audience-maturity-intelligence-v1');
    expect(serialized).toContain('Section maturity primitives:');
    expect(serialized).toContain('diagnose/problem_diagnosis');
    expect(serialized.length).toBeLessThan(7000);
  });

  it('integrates audience maturity into generation context and prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.audienceMaturity.version).toBe('audience-maturity-intelligence-v1');
    expect(context.audienceMaturity.sections).toHaveLength(5);
    expect(promptContext).toContain('## AUDIENCE MATURITY INTELLIGENCE');
    expect(promptContext).toContain('Global maturity expectations:');
    expect(promptContext).toContain('Section maturity primitives:');
  });
});
