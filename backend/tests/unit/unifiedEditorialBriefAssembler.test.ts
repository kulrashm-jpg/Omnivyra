import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { buildAudienceMaturityIntelligence } from '../../../lib/content/audienceMaturityIntelligence';
import { buildEditorialAuthorityIntelligence } from '../../../lib/content/editorialAuthorityIntelligence';
import { buildEditorialDepthIntelligence } from '../../../lib/content/editorialDepthIntelligence';
import { buildGenerationGuidanceContract } from '../../../lib/content/generationGuidanceContracts';
import { buildNarrativePlanningPrimitives } from '../../../lib/content/narrativePlanningEngine';
import { resolveOmnivyraDoctrineGenerationContext } from '../../../lib/content/omnivyraEditorialDoctrine';
import {
  assembleUnifiedEditorialBrief,
  serializeUnifiedEditorialBrief,
} from '../../../lib/content/unifiedEditorialBriefAssembler';
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

function buildBrief(sectionCount = 6) {
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
  return {
    doctrine,
    assimilation,
    narrativePlanning,
    generationGuidance,
    editorialDepth,
    editorialAuthority,
    audienceMaturity,
    unifiedEditorialBrief,
  };
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())).size !== values.length;
}

describe('unifiedEditorialBriefAssembler', () => {
  it('composes deterministic section-level editorial briefs', () => {
    const first = buildBrief().unifiedEditorialBrief;
    const second = buildBrief().unifiedEditorialBrief;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('unified-editorial-brief-v1');
    expect(first.sections).toHaveLength(6);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);

    for (const section of first.sections) {
      expect(section.sectionEditorialObjective).toBeTruthy();
      expect(section.sectionNarrativeExpectation.length).toBeGreaterThan(0);
      expect(section.sectionDepthExpectation.length).toBeGreaterThan(0);
      expect(section.sectionAuthorityExpectation.length).toBeGreaterThan(0);
      expect(section.sectionAudienceExpectation.length).toBeGreaterThan(0);
      expect(section.sectionOperationalExpectation.length).toBeGreaterThan(0);
      expect(section.sectionProofExpectation.length).toBeGreaterThan(0);
      expect(section.sectionTransitionExpectation).toBeTruthy();
      expect(section.sectionDifferentiationExpectation).toBeTruthy();
      expect(section.sectionRiskFlags.length).toBeGreaterThan(0);
      expect(section.sectionReaderStateTarget).toContain('->');
      expect(section.sectionStrategicTension.length).toBeGreaterThan(0);
      expect(section.sectionTerminologyGuidance.length).toBeGreaterThan(0);
      expect(section.sectionClaimQualificationGuidance.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates overlapping cross-layer guidance within brief fields', () => {
    const { unifiedEditorialBrief } = buildBrief();
    const first = unifiedEditorialBrief.sections[0];

    expect(hasDuplicates(first.sectionRiskFlags)).toBe(false);
    expect(hasDuplicates(first.sectionProofExpectation)).toBe(false);
    expect(hasDuplicates(first.sectionStrategicTension)).toBe(false);
  });

  it('normalizes section priorities around objective, reader state, risk, and proof', () => {
    const { unifiedEditorialBrief } = buildBrief();
    const diagnose = unifiedEditorialBrief.sections.find((section) => section.progressionStage === 'diagnose');

    expect(diagnose?.sectionEditorialObjective).toContain('campaign signals');
    expect(diagnose?.sectionReaderStateTarget).toContain('recognizing AI content operations');
    expect(diagnose?.sectionRiskFlags.join(' ')).toContain('Do not reuse');
    expect(diagnose?.sectionProofExpectation.join(' ')).toContain('workflow pressure');
  });

  it('preserves narrative ordering and anti-repetition intent', () => {
    const { narrativePlanning, unifiedEditorialBrief } = buildBrief();

    expect(unifiedEditorialBrief.progressionStages).toEqual(narrativePlanning.progressionStages);
    expect(unifiedEditorialBrief.sections.map((section) => section.progressionStage)).toEqual(narrativePlanning.progressionStages);
    expect(unifiedEditorialBrief.antiRepetitionRules).toEqual(narrativePlanning.antiRepetitionRules);
  });

  it('preserves authority, maturity, and depth expectations', () => {
    const { unifiedEditorialBrief } = buildBrief();
    const operationalize = unifiedEditorialBrief.sections.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.sectionAuthorityExpectation.join(' ')).toContain('implementation realism');
    expect(operationalize?.sectionAudienceExpectation.join(' ')).toContain('operator-heavy detail');
    expect(operationalize?.sectionDepthExpectation.join(' ')).toContain('implementation nuance');
    expect(operationalize?.sectionOperationalExpectation.join(' ')).toContain('decision points');
  });

  it('serializes compact section-level briefs', () => {
    const { unifiedEditorialBrief } = buildBrief();
    const serialized = serializeUnifiedEditorialBrief(unifiedEditorialBrief);

    expect(serialized).toContain('## UNIFIED EDITORIAL BRIEF');
    expect(serialized).toContain('Version: unified-editorial-brief-v1');
    expect(serialized).toContain('Section briefs:');
    expect(serialized).toContain('diagnose/problem_diagnosis');
    expect(serialized.length).toBeLessThan(7500);
  });

  it('integrates unified briefs into generation context and prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.unifiedEditorialBrief.version).toBe('unified-editorial-brief-v1');
    expect(context.unifiedEditorialBrief.sections).toHaveLength(5);
    expect(promptContext).toContain('## UNIFIED EDITORIAL BRIEF');
    expect(promptContext).toContain('Global priorities:');
    expect(promptContext).toContain('Section briefs:');
  });
});
