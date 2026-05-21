import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import {
  buildEditorialAuthorityIntelligence,
  serializeEditorialAuthorityIntelligence,
} from '../../../lib/content/editorialAuthorityIntelligence';
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

function buildAuthority(overrides: { companyContext?: typeof companyContext | Record<string, never>; sectionCount?: number } = {}) {
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
  return { doctrine, assimilation, narrativePlanning, generationGuidance, editorialDepth, editorialAuthority };
}

describe('editorialAuthorityIntelligence', () => {
  it('generates deterministic structured authority primitives', () => {
    const first = buildAuthority().editorialAuthority;
    const second = buildAuthority().editorialAuthority;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.version).toBe('editorial-authority-intelligence-v1');
    expect(first.sections).toHaveLength(6);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);

    for (const section of first.sections) {
      expect(section.authoritySignalTargets.length).toBeGreaterThan(0);
      expect(section.evidenceExpectations.length).toBeGreaterThan(0);
      expect(section.proofTypePreferences.length).toBeGreaterThan(0);
      expect(section.citationBehaviorTargets.length).toBeGreaterThan(0);
      expect(section.operationalCredibilitySignals.length).toBeGreaterThan(0);
      expect(section.scenarioEvidenceTargets.length).toBeGreaterThan(0);
      expect(section.implementationProofTargets.length).toBeGreaterThan(0);
      expect(section.trustBuildingSignals.length).toBeGreaterThan(0);
      expect(section.claimQualificationTargets.length).toBeGreaterThan(0);
      expect(section.evidenceDepthExpectations.length).toBeGreaterThan(0);
      expect(section.expertiseVisibilityTargets.length).toBeGreaterThan(0);
      expect(section.authorityRiskSignals.length).toBeGreaterThan(0);
    }
  });

  it('maps narrative stages to proof and authority expectations', () => {
    const { editorialAuthority } = buildAuthority();
    const diagnose = editorialAuthority.sections.find((section) => section.progressionStage === 'diagnose');
    const operationalize = editorialAuthority.sections.find((section) => section.progressionStage === 'operationalize');
    const validate = editorialAuthority.sections.find((section) => section.progressionStage === 'validate');

    expect(diagnose?.proofTypePreferences).toContain('workflow pressure');
    expect(operationalize?.proofTypePreferences).toContain('decision checkpoint');
    expect(validate?.authoritySignalTargets.join(' ')).toContain('proof standards');
  });

  it('generates citation behavior without retrieval or invented evidence', () => {
    const { editorialAuthority } = buildAuthority();
    const validate = editorialAuthority.sections.find((section) => section.progressionStage === 'validate');

    expect(validate?.citationBehaviorTargets.join(' ')).toContain('cite sourced facts');
    expect(validate?.citationBehaviorTargets.join(' ')).toContain('Never invent metrics');
    expect(editorialAuthority.globalAuthorityExpectations.join(' ')).toContain('Never invent metrics');
  });

  it('maps doctrine posture into claim qualification expectations', () => {
    const { doctrine, editorialAuthority } = buildAuthority();
    const reframe = editorialAuthority.sections.find((section) => section.progressionStage === 'reframe');

    expect(reframe?.claimQualificationTargets.join(' ')).toContain(doctrine.strategicBeliefs[0]);
    expect(reframe?.claimQualificationTargets.join(' ')).toContain('Do not treat generic framing as authority');
  });

  it('maps assimilation primitives into operational credibility and expertise visibility', () => {
    const { editorialAuthority } = buildAuthority();
    const operationalize = editorialAuthority.sections.find((section) => section.progressionStage === 'operationalize');

    expect(operationalize?.operationalCredibilitySignals.join(' ')).toContain('teams cannot connect campaign signals');
    expect(operationalize?.expertiseVisibilityTargets.join(' ')).toContain('marketing intelligence');
    expect(operationalize?.scenarioEvidenceTargets.join(' ')).toContain('growth operators');
  });

  it('models evidence sophistication from editorial depth maturity', () => {
    const rich = buildAuthority().editorialAuthority;
    const sparse = buildAuthority({ companyContext: {} }).editorialAuthority;

    expect(rich.maturityStage).toBe('advanced');
    expect(rich.sections[0].evidenceDepthExpectations.join(' ')).toContain('executive-level decision impact');
    expect(sparse.maturityStage).toBe('foundational');
    expect(sparse.sections[0].evidenceDepthExpectations.join(' ')).toContain('concrete scenarios');
  });

  it('serializes compact generation-safe authority context', () => {
    const { editorialAuthority } = buildAuthority();
    const serialized = serializeEditorialAuthorityIntelligence(editorialAuthority);

    expect(serialized).toContain('## EDITORIAL AUTHORITY INTELLIGENCE');
    expect(serialized).toContain('Version: editorial-authority-intelligence-v1');
    expect(serialized).toContain('Section authority primitives:');
    expect(serialized).toContain('diagnose/problem_diagnosis');
    expect(serialized.length).toBeLessThan(7000);
  });

  it('integrates authority intelligence into generation context and prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.editorialAuthority.version).toBe('editorial-authority-intelligence-v1');
    expect(context.editorialAuthority.sections).toHaveLength(5);
    expect(promptContext).toContain('## EDITORIAL AUTHORITY INTELLIGENCE');
    expect(promptContext).toContain('Global authority expectations:');
    expect(promptContext).toContain('Section authority primitives:');
  });
});
