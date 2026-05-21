import { assimilateCompanyEditorialPrimitives } from '../../../lib/content/companyAssimilationMiddleware';
import {
  buildGenerationGuidanceContract,
  serializeGenerationGuidanceContract,
} from '../../../lib/content/generationGuidanceContracts';
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

function buildContract() {
  const doctrine = resolveOmnivyraDoctrineGenerationContext();
  const assimilation = assimilateCompanyEditorialPrimitives(companyContext);
  const narrativePlanning = buildNarrativePlanningPrimitives({
    topic: 'AI content operations',
    contentType: 'blog',
    doctrine,
    assimilation,
    sectionCount: 6,
  });
  return buildGenerationGuidanceContract({ doctrine, assimilation, narrativePlanning });
}

describe('generationGuidanceContracts', () => {
  it('generates deterministic guidance contracts', () => {
    const first = buildContract();
    const second = buildContract();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections[0])).toBe(true);
  });

  it('maps narrative stages to generation expectations', () => {
    const contract = buildContract();
    const diagnose = contract.sections.find((section) => section.progressionStage === 'diagnose');
    const operationalize = contract.sections.find((section) => section.progressionStage === 'operationalize');

    expect(diagnose?.allowedNarrativeMoves).toContain('name the operating tension');
    expect(diagnose?.forbiddenNarrativeMoves).toContain('open with generic market scenery');
    expect(operationalize?.allowedNarrativeMoves).toContain('translate the idea into decisions');
    expect(operationalize?.forbiddenNarrativeMoves).toContain('offer vague advice without workflow behavior');
  });

  it('maps section differentiation from assimilation POV angles', () => {
    const contract = buildContract();

    expect(contract.sections[0].sectionDifferentiationRule).toContain('Operator-first diagnosis');
    expect(contract.sections[1].sectionDifferentiationRule).toContain('Systems over outputs');
    expect(contract.sections[2].sectionDifferentiationRule).toContain('Intelligence to execution');
  });

  it('maps doctrine constraints into forbidden narrative moves', () => {
    const contract = buildContract();

    expect(contract.globalForbiddenNarrativeMoves).toEqual(
      expect.arrayContaining([
        'generic framing: in today\'s fast-paced digital landscape',
        'collapsing multiple narrative stages into one generic overview',
      ]),
    );
    expect(contract.sections[0].forbiddenNarrativeMoves.some((move) => move.includes('businesses need to leverage'))).toBe(true);
  });

  it('maps assimilation primitives into proof and strategic framing guidance', () => {
    const contract = buildContract();
    const validate = contract.sections.find((section) => section.progressionStage === 'validate');

    expect(contract.sections[0].sectionGenerationIntent).toContain('campaign signals');
    expect(contract.sections[1].sectionGenerationIntent).toContain('workflow governance');
    expect(validate?.proofBehavior).toContain('Strategic proof anchor');
    expect(validate?.proofBehavior).toContain('concrete scenarios');
  });

  it('maps redundancy boundaries into repetition avoidance targets', () => {
    const contract = buildContract();

    for (const section of contract.sections) {
      expect(section.repetitionAvoidanceTargets.join(' ')).toContain(section.narrativeRole);
      expect(section.argumentBoundary).toContain(section.progressionStage);
      expect(section.argumentBoundary).toContain(section.narrativeRole);
    }
  });

  it('generates reader-awareness targets from reader-state shifts', () => {
    const contract = buildContract();

    expect(contract.sections[0].readerAwarenessTarget).toContain('recognizing AI content operations');
    expect(contract.sections[0].readerAwarenessTarget).toContain('operating tension');
    expect(contract.sections[5].readerAwarenessTarget).toContain('strategic operating implication');
  });

  it('serializes a compact prompt-safe context block', () => {
    const contract = buildContract();
    const serialized = serializeGenerationGuidanceContract(contract);

    expect(serialized).toContain('## GENERATOR GUIDANCE CONTRACT');
    expect(serialized).toContain('Version: generation-guidance-contract-v1');
    expect(serialized).toContain('Section contracts:');
    expect(serialized).toContain('diagnose/problem_diagnosis');
    expect(serialized.length).toBeLessThan(6500);
  });

  it('integrates guidance contracts into generation context and prompt assembly', async () => {
    const context = await buildGenerationContext({
      contentType: 'blog',
      topic: 'AI content operations',
      companyId: 'company-1',
      companyContext,
      sectionCount: 5,
    });
    const promptContext = buildUnifiedPromptContext(context);

    expect(context.generationGuidance.version).toBe('generation-guidance-contract-v1');
    expect(context.generationGuidance.sections).toHaveLength(5);
    expect(promptContext).toContain('## GENERATOR GUIDANCE CONTRACT');
    expect(promptContext).toContain('Global forbidden moves:');
    expect(promptContext).toContain('Section contracts:');
  });
});

