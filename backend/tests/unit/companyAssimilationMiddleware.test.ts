import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import { getOmnivyraEditorialDoctrine } from '../../../lib/content/omnivyraEditorialDoctrine';
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

const sampleCompany = {
  companyName: 'SignalForge',
  industry: 'B2B marketing intelligence',
  audience: 'growth operators at mid-market SaaS companies',
  coreProblemStatement: 'teams cannot connect campaign signals to daily execution decisions',
  painSymptoms: [
    'fragmented campaign feedback',
    'fragmented campaign feedback',
    'unclear content prioritization',
  ],
  uniqueValue: 'turns marketing signals into governed execution choices',
  competitiveAdvantages: 'closed-loop attribution; workflow governance; execution learning',
  productsServices: 'an AI marketing intelligence workspace',
  desiredTransformation: 'from scattered campaign activity to governed execution intelligence',
  authorityDomains: ['marketing intelligence', 'content operations', 'attribution'],
  keyMessages: 'systems beat isolated content output',
  strategyProfile: {
    worldview: 'content should be governed by execution intelligence',
    differentiation: ['workflow governance', 'closed-loop attribution'],
    typicalAngles: ['systems over output volume'],
  },
};

describe('companyAssimilationMiddleware', () => {
  it('produces deterministic assimilation for the same company input', () => {
    const first = assimilateCompanyEditorialPrimitives(sampleCompany);
    const second = assimilateCompanyEditorialPrimitives(sampleCompany);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.buyerTension)).toBe(true);
    expect(Object.isFrozen(first.approvedPovAngles)).toBe(true);
  });

  it('normalizes sparse profiles without throwing or returning empty primitives', () => {
    const primitives = assimilateCompanyEditorialPrimitives({
      companyName: 'SparseCo',
      audience: 'marketing teams',
    });

    expect(primitives.completeness.level).toBe('sparse');
    expect(primitives.buyerTension.statement).toContain('marketing teams');
    expect(primitives.operatingPain.primary).toContain('unclear operating priorities');
    expect(primitives.transformationMechanism.mechanism).toContain('diagnosis');
    expect(primitives.authorityClaim.claim).toContain('SparseCo');
  });

  it('extracts and deduplicates differentiator logic', () => {
    const primitives = assimilateCompanyEditorialPrimitives(sampleCompany);

    expect(primitives.differentiatorLogic.primary).toBe('closed-loop attribution');
    expect(primitives.differentiatorLogic.supporting).toContain('workflow governance');
    expect(primitives.differentiatorLogic.supporting.filter((item) => item === 'workflow governance')).toHaveLength(1);
    expect(primitives.differentiatorLogic.logic).toContain('SignalForge');
  });

  it('extracts company-compatible POV angles from doctrine archetypes', () => {
    const primitives = assimilateCompanyEditorialPrimitives(sampleCompany);
    const povIds = primitives.approvedPovAngles.map((angle) => angle.doctrinePovId);

    expect(povIds).toEqual(expect.arrayContaining([
      'operator_first',
      'systems_over_outputs',
      'intelligence_to_execution',
      'authority_with_proof',
      'workflow_realism',
    ]));
    expect(primitives.approvedPovAngles[0].angle).toContain('fragmented campaign feedback');
  });

  it('generates authority claims and transformation mechanisms from available profile fields', () => {
    const primitives = assimilateCompanyEditorialPrimitives(sampleCompany);

    expect(primitives.authorityClaim.claim).toContain('B2B marketing intelligence');
    expect(primitives.authorityClaim.basis).toEqual(expect.arrayContaining([
      'marketing intelligence',
      'an AI marketing intelligence workspace',
    ]));
    expect(primitives.transformationMechanism.from).toBe('fragmented campaign feedback');
    expect(primitives.transformationMechanism.to).toBe('from scattered campaign activity to governed execution intelligence');
    expect(primitives.transformationMechanism.mechanism).toContain('an AI marketing intelligence workspace');
  });

  it('remains compatible with the doctrine POV model', () => {
    const doctrine = getOmnivyraEditorialDoctrine();
    const doctrineIds = new Set(doctrine.approvedPovArchetypes.map((pov) => pov.id));
    const primitives = assimilateCompanyEditorialPrimitives(sampleCompany, doctrine);

    expect(primitives.approvedPovAngles.length).toBeGreaterThan(0);
    for (const angle of primitives.approvedPovAngles) {
      expect(doctrineIds.has(angle.doctrinePovId)).toBe(true);
    }
    expect(primitives.proofExpectations).toEqual(expect.arrayContaining(doctrine.proofStandards.slice(0, 2)));
  });

  it('adds assimilation primitives to generation context and unified context output', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext: sampleCompany,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.assimilation.buyerTension.statement).toContain('growth operators');
    expect(context.assimilation.differentiatorLogic.primary).toBe('closed-loop attribution');
    expect(promptContext).toContain('## COMPANY ASSIMILATION PRIMITIVES');
    expect(promptContext).toContain('Buyer tension:');
    expect(promptContext).toContain('Approved company POV angles:');
  });
});
