import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { prioritizeEditorialRuntimeContext } from '../../../lib/content/editorialRuntimeContextPrioritizer';
import {
  buildGeneratorRuntimeAlignment,
  serializeGeneratorRuntimeAlignment,
} from '../../../lib/content/generatorRuntimeAlignment';
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

function buildAlignment(sectionCount = 6) {
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
  return { narrativePlanning, unifiedEditorialBrief, generatorRuntimeAlignment };
}

describe('generatorRuntimeAlignment', () => {
  it('generates deterministic runtime directives', () => {
    const first = buildAlignment().generatorRuntimeAlignment;
    const second = buildAlignment().generatorRuntimeAlignment;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('generator-runtime-alignment-v1');
    expect(first.runtimeGenerationDirectives.join(' ')).toContain('operational generation plan');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sectionRuntimeObjectives[0])).toBe(true);
  });

  it('maps unified brief sections into runtime objectives', () => {
    const { generatorRuntimeAlignment } = buildAlignment();
    const diagnose = generatorRuntimeAlignment.sectionRuntimeObjectives[0];

    expect(diagnose.runtimeObjective).toContain('campaign signals');
    expect(diagnose.readerStateTarget).toContain('recognizing AI content operations');
    expect(diagnose.differentiationTarget).toContain('Operator-first diagnosis');
  });

  it('preserves narrative sequence and reader-state targets', () => {
    const { narrativePlanning, generatorRuntimeAlignment } = buildAlignment();

    expect(generatorRuntimeAlignment.runtimeNarrativeSequence).toEqual(
      narrativePlanning.sections.map((section) => `${section.progressionStage}/${section.narrativeRole}`),
    );
    expect(generatorRuntimeAlignment.runtimeReaderStateTargets[0]).toContain('operating tension');
  });

  it('maps anti-repetition and risk awareness into runtime guidance', () => {
    const { generatorRuntimeAlignment } = buildAlignment();

    expect(generatorRuntimeAlignment.runtimeAntiRepetitionSignals.join(' ')).toContain('Each section owns one narrative role');
    expect(generatorRuntimeAlignment.runtimeAntiRepetitionSignals.join(' ')).toContain('Direct-answer blocks');
    expect(generatorRuntimeAlignment.runtimeRiskAwarenessSignals.join(' ')).toContain('Do not reuse');
  });

  it('preserves authority and depth targets for generation', () => {
    const { generatorRuntimeAlignment } = buildAlignment();
    const operationalize = generatorRuntimeAlignment.sectionRuntimeObjectives.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.authorityTarget.join(' ')).toContain('implementation realism');
    expect(operationalize?.depthTarget.join(' ')).toContain('implementation nuance');
    expect(generatorRuntimeAlignment.runtimeAuthorityTargets.join(' ')).toContain('problem specificity');
    expect(generatorRuntimeAlignment.runtimeDepthTargets.join(' ')).toContain('specificity of the problem');
  });

  it('serializes generator runtime directives compactly', () => {
    const { generatorRuntimeAlignment } = buildAlignment();
    const serialized = serializeGeneratorRuntimeAlignment(generatorRuntimeAlignment);

    expect(serialized).toContain('## GENERATOR RUNTIME DIRECTIVES');
    expect(serialized).toContain('Runtime generation directives:');
    expect(serialized).toContain('Runtime narrative sequence:');
    expect(serialized).toContain('Section runtime objectives:');
    expect(serialized.length).toBeLessThan(9000);
  });

  it('integrates generator runtime directives into prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.generatorRuntimeAlignment.version).toBe('generator-runtime-alignment-v1');
    expect(context.generatorRuntimeAlignment.sectionRuntimeObjectives).toHaveLength(5);
    expect(promptContext).toContain('## GENERATOR RUNTIME DIRECTIVES');
    expect(promptContext).toContain('Runtime generation directives:');
    expect(promptContext).toContain('Section runtime objectives:');
  });
});
