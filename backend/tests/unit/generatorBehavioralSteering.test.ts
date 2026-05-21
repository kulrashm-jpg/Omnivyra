import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { prioritizeEditorialRuntimeContext } from '../../../lib/content/editorialRuntimeContextPrioritizer';
import { buildGeneratorRuntimeAlignment } from '../../../lib/content/generatorRuntimeAlignment';
import {
  buildGeneratorBehavioralSteering,
  serializeGeneratorBehavioralSteering,
} from '../../../lib/content/generatorBehavioralSteering';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import { assembleUnifiedEditorialBrief } from '../../../lib/content/unifiedEditorialBriefAssembler';
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

function buildSteering(sectionCount = 6) {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount,
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
  return { narrativePlanning, generatorRuntimeAlignment, generatorBehavioralSteering };
}

describe('generatorBehavioralSteering', () => {
  it('generates deterministic behavioral steering primitives', () => {
    const first = buildSteering().generatorBehavioralSteering;
    const second = buildSteering().generatorBehavioralSteering;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('generator-behavioral-steering-v1');
    expect(first.sectionBehavioralPriorities).toHaveLength(6);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sectionBehavioralPriorities[0])).toBe(true);
  });

  it('maps section priorities from runtime objectives', () => {
    const { generatorBehavioralSteering } = buildSteering();
    const diagnose = generatorBehavioralSteering.sectionBehavioralPriorities[0];

    expect(diagnose.primaryBehavior).toContain('diagnose the operating tension');
    expect(diagnose.behavioralPriorities.join(' ')).toContain('campaign signals');
    expect(diagnose.readerStateBehaviorSignals.join(' ')).toContain('operating tension');
  });

  it('preserves narrative behavior mapping', () => {
    const { narrativePlanning, generatorBehavioralSteering } = buildSteering();

    expect(generatorBehavioralSteering.narrativeBehaviorSignals.join(' ')).toContain('diagnose/problem_diagnosis');
    expect(generatorBehavioralSteering.narrativeBehaviorSignals.join(' ')).toContain('operationalize/operating_translation');
    expect(generatorBehavioralSteering.sectionBehavioralPriorities.map((section) => section.progressionStage)).toEqual(narrativePlanning.progressionStages);
  });

  it('maps authority and anti-repetition behavior signals', () => {
    const { generatorBehavioralSteering } = buildSteering();

    expect(generatorBehavioralSteering.authorityBehaviorSignals.join(' ')).toContain('problem specificity');
    expect(generatorBehavioralSteering.antiRepetitionBehaviorSignals.join(' ')).toContain('Each section owns one narrative role');
    expect(generatorBehavioralSteering.antiRepetitionBehaviorSignals.join(' ')).toContain('Do not reuse');
  });

  it('maps operational realism and depth behavior signals', () => {
    const { generatorBehavioralSteering } = buildSteering();
    const operationalize = generatorBehavioralSteering.sectionBehavioralPriorities.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.operationalRealismBehaviorSignals.join(' ')).toContain('decision points');
    expect(operationalize?.depthBehaviorSignals.join(' ')).toContain('implementation nuance');
    expect(generatorBehavioralSteering.operationalRealismBehaviorSignals.join(' ')).toContain('workflow');
  });

  it('serializes behavioral steering compactly', () => {
    const { generatorBehavioralSteering } = buildSteering();
    const serialized = serializeGeneratorBehavioralSteering(generatorBehavioralSteering);

    expect(serialized).toContain('## GENERATOR BEHAVIORAL STEERING');
    expect(serialized).toContain('Narrative behavior signals:');
    expect(serialized).toContain('Anti-repetition behavior signals:');
    expect(serialized).toContain('Section behavioral priorities:');
    expect(serialized.length).toBeLessThan(9000);
  });

  it('integrates behavioral steering into prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.generatorBehavioralSteering.version).toBe('generator-behavioral-steering-v1');
    expect(context.generatorBehavioralSteering.sectionBehavioralPriorities).toHaveLength(5);
    expect(promptContext).toContain('## GENERATOR BEHAVIORAL STEERING');
    expect(promptContext).toContain('Section behavioral priorities:');
  });
});
