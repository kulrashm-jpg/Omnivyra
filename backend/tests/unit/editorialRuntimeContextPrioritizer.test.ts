import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import { assembleUnifiedEditorialBrief } from '../../../lib/content/unifiedEditorialBriefAssembler';
import {
  prioritizeEditorialRuntimeContext,
  serializeEditorialRuntimeContext,
} from '../../../lib/content/editorialRuntimeContextPrioritizer';
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

function buildRuntimeContext(sectionCount = 6) {
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
  return {
    doctrine,
    assimilation,
    narrativePlanning,
    unifiedEditorialBrief,
    editorialRuntimeContext,
  };
}

function hasDuplicates(values: readonly string[]): boolean {
  const normalized = values.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return new Set(normalized).size !== normalized.length;
}

describe('editorialRuntimeContextPrioritizer', () => {
  it('generates deterministic runtime-priority context', () => {
    const first = buildRuntimeContext().editorialRuntimeContext;
    const second = buildRuntimeContext().editorialRuntimeContext;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-runtime-context-prioritizer-v1');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.runtimePriorityMap[0])).toBe(true);
  });

  it('uses unified editorial brief as canonical generation context', () => {
    const { editorialRuntimeContext } = buildRuntimeContext();

    expect(editorialRuntimeContext.canonicalGenerationContext).toContain('## UNIFIED EDITORIAL BRIEF');
    expect(editorialRuntimeContext.canonicalGenerationContext).toContain('Section briefs:');
    expect(editorialRuntimeContext.runtimePriorityMap[0]).toEqual({
      layer: 'unifiedEditorialBrief',
      priority: 'canonical',
      retention: 'full-compact',
    });
  });

  it('deduplicates primary, secondary, compatibility, and debug signals', () => {
    const { editorialRuntimeContext } = buildRuntimeContext();

    expect(hasDuplicates(editorialRuntimeContext.primaryEditorialSignals)).toBe(false);
    expect(hasDuplicates(editorialRuntimeContext.secondaryEditorialSignals)).toBe(false);
    expect(hasDuplicates(editorialRuntimeContext.compatibilitySignals)).toBe(false);
    expect(hasDuplicates(editorialRuntimeContext.debugSignals)).toBe(false);
  });

  it('retains compatibility and debug visibility for lower-priority layers', () => {
    const { editorialRuntimeContext } = buildRuntimeContext();

    expect(editorialRuntimeContext.compatibilitySignals.join('\n')).toContain('## OMNIVYRA EDITORIAL DOCTRINE');
    expect(editorialRuntimeContext.compatibilitySignals.join('\n')).toContain('## COMPANY ASSIMILATION PRIMITIVES');
    expect(editorialRuntimeContext.compatibilitySignals.join('\n')).toContain('## GENERATOR GUIDANCE CONTRACT');
    expect(editorialRuntimeContext.debugSignals.join(' ')).toContain('Assimilation completeness');
    expect(editorialRuntimeContext.debugSignals.join(' ')).toContain('Unified brief version');
  });

  it('preserves narrative section order through the canonical context', () => {
    const { narrativePlanning, editorialRuntimeContext } = buildRuntimeContext();

    expect(editorialRuntimeContext.primaryEditorialSignals.join(' ')).toContain(narrativePlanning.progressionStages.join(' -> '));
    expect(editorialRuntimeContext.canonicalGenerationContext).toContain('diagnose/problem_diagnosis');
    expect(editorialRuntimeContext.canonicalGenerationContext).toContain('resolve/strategic_resolution');
  });

  it('serializes compact primary runtime context', () => {
    const { editorialRuntimeContext } = buildRuntimeContext();
    const serialized = serializeEditorialRuntimeContext(editorialRuntimeContext);

    expect(serialized).toContain('## PRIMARY EDITORIAL RUNTIME CONTEXT');
    expect(serialized).toContain('Canonical generation context:');
    expect(serialized).toContain('## EDITORIAL RUNTIME PRIORITIES');
    expect(serialized).toContain('## EDITORIAL COMPATIBILITY SIGNALS');
    expect(serialized).toContain('## EDITORIAL DEBUG SIGNALS');
    expect(serialized.length).toBeLessThan(13000);
  });

  it('integrates prioritized runtime context into generation prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.editorialRuntimeContext.version).toBe('editorial-runtime-context-prioritizer-v1');
    expect(promptContext).toContain('## PRIMARY EDITORIAL RUNTIME CONTEXT');
    expect(promptContext).toContain('## UNIFIED EDITORIAL BRIEF');
    expect(promptContext).toContain('## EDITORIAL COMPATIBILITY SIGNALS');
    expect(promptContext).toContain('## OMNIVYRA EDITORIAL DOCTRINE');
  });
});
