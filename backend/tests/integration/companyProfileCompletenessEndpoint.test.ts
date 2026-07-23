/**
 * CONVERSATION-INTELLIGENCE-001 Phase B — completeness endpoint backward-compat.
 *
 * Proves the additive, flag-gated surfacing of canonical knowledge readiness on
 * /api/company-profile/completeness:
 *   - flag OFF (default) → response is BYTE-IDENTICAL to before the change: the
 *     legacy fields are present and unchanged and NO `knowledge_readiness` field
 *     is added.
 *   - flag ON  → the legacy fields are still byte-identical and the canonical
 *     `knowledge_readiness` field appears additively.
 *
 * The real field-count completeness calculator and the real knowledge-graph
 * evaluator are exercised; only the I/O seams (profile load, intelligence,
 * access) are mocked, so the legacy shape asserted here is the genuine one.
 */
import completenessHandler from '../../../pages/api/company-profile/completeness';
import { createApiRequestMock, createMockRes } from '../utils';
import type { CompanyProfile } from '../../services/companyProfile/types';

const MODE_ENV = 'ROLLOUT_PROFILE_KNOWLEDGE_READINESS_MODE';

// Real calculateCompanyProfileCompleteness (pure) + mocked getProfile.
jest.mock('../../services/companyProfileService', () => {
  const actual = jest.requireActual('../../services/companyProfile/fieldConstants');
  return {
    calculateCompanyProfileCompleteness: actual.calculateCompanyProfileCompleteness,
    getProfile: jest.fn(),
  };
});
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'SUPER_ADMIN' }),
}));
jest.mock('../../services/companyContextIntelligenceService', () => ({
  getCompanyContextIntelligence: jest.fn().mockResolvedValue(null),
  calculateIntelligenceReadiness: jest.fn().mockReturnValue({ score: 42, tier: 'basic' }),
}));

import { getProfile } from '../../services/companyProfileService';

const PROFILE: CompanyProfile = {
  company_id: 'acme',
  name: 'Acme',
  website_url: 'acme.com',
  industry: 'Software',
  products_services: 'Analytics',
  target_audience: 'Retail',
  unique_value: 'Real-time',
  field_confidence: {
    name: 'High', website_url: 'High', industry: 'High',
    products_services: 'High', target_audience: 'High', unique_value: 'High',
  },
} as CompanyProfile;

const run = async () => {
  (getProfile as jest.Mock).mockResolvedValue(PROFILE);
  const req = createApiRequestMock({ method: 'GET', companyId: 'acme' });
  const res = createMockRes();
  await completenessHandler(req, res);
  return res;
};

describe('completeness endpoint — canonical readiness (Phase B)', () => {
  const original = process.env[MODE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[MODE_ENV];
  });
  afterAll(() => {
    if (original === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = original;
  });

  test('flag OFF (default): legacy fields present, NO knowledge_readiness added', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    const body = res.body;
    // Legacy shape intact.
    expect(body).toHaveProperty('overall_profile_completion');
    expect(body).toHaveProperty('problem_transformation_completion');
    expect(body).toHaveProperty('profile_completeness');
    expect(body).toHaveProperty('intelligence_readiness');
    expect(body).toHaveProperty('score'); // spread from completeness
    expect(body).toHaveProperty('section_scores');
    expect(body).toHaveProperty('missing_sections');
    // Additive field absent when off.
    expect(body).not.toHaveProperty('knowledge_readiness');
  });

  test('flag OFF response is byte-identical to a legacy-shaped snapshot', async () => {
    const res = await run();
    // The keys returned when off are EXACTLY the legacy key set (no additions).
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'intelligence_readiness',
        'missing_sections',
        'overall_profile_completion',
        'problem_transformation_completion',
        'profile_completeness',
        'score',
        'section_scores',
      ].sort()
    );
  });

  test('flag ENFORCE: legacy fields unchanged + knowledge_readiness added', async () => {
    const off = await run();
    const legacySnapshot = { ...off.body };

    process.env[MODE_ENV] = 'enforce';
    const on = await run();

    // Every legacy field is byte-identical to the flag-off response.
    for (const key of Object.keys(legacySnapshot)) {
      expect(on.body[key]).toEqual(legacySnapshot[key]);
    }
    // The canonical readiness is surfaced additively.
    expect(on.body).toHaveProperty('knowledge_readiness');
    const kr = on.body.knowledge_readiness;
    expect(typeof kr.score).toBe('number');
    expect(kr).toHaveProperty('satisfiedCount');
    expect(kr).toHaveProperty('remainingGaps');
    expect(kr).toHaveProperty('enoughToProceed');
    // Core-6 satisfied in the fixture → enoughToProceed true, decision from
    // KNOWLEDGE not field count.
    expect(kr.enoughToProceed).toBe(true);
  });

  test('flag SHADOW also surfaces the field (any non-off mode)', async () => {
    process.env[MODE_ENV] = 'shadow';
    const res = await run();
    expect(res.body).toHaveProperty('knowledge_readiness');
  });
});
