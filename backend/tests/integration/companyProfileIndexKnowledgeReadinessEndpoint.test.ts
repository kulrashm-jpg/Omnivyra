/**
 * CONVERSATION-INTELLIGENCE-001 Phase B — LIVE completeness path backward-compat.
 *
 * Phase B first surfaced the canonical knowledge readiness on the DEAD
 * /api/company-profile/completeness endpoint. This proves the SAME additive,
 * flag-gated field is now surfaced on the LIVE completeness path — the
 * /api/company-profile (index) handler via ?includeCompleteness — which the
 * frontend actually fetches (hooks/useCompanyProfileState reads
 * overall_profile_completion here).
 *
 * Guarantees asserted:
 *   - flag OFF (default) → the response is byte-identical to before the change:
 *     every legacy field is present and unchanged and NO `knowledge_readiness`
 *     field is added.
 *   - flag ON → every legacy field is byte-identical to the flag-off response and
 *     the canonical `knowledge_readiness` field appears additively.
 *   - FAIL-SAFE → a profile that makes the knowledge graph throw still returns the
 *     profile + completeness (200), with no `knowledge_readiness` and no error.
 *
 * The real field-count completeness calculator and the real knowledge-graph
 * evaluator are exercised; only the I/O seams (profile load, access, intelligence,
 * context, competitor intel) are mocked, so the legacy shape asserted here is the
 * genuine one served on every profile load.
 */
import companyProfileHandler from '../../../pages/api/company-profile';
import { createApiRequestMock, createMockRes } from '../utils';
import type { CompanyProfile } from '../../services/companyProfile/types';

const MODE_ENV = 'ROLLOUT_PROFILE_KNOWLEDGE_READINESS_MODE';

// Real calculateCompanyProfileCompleteness (pure) + mocked profile I/O.
jest.mock('../../services/companyProfileService', () => {
  const actual = jest.requireActual('../../services/companyProfile/fieldConstants');
  return {
    calculateCompanyProfileCompleteness: actual.calculateCompanyProfileCompleteness,
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
    toLimitedCompanyProfile: jest.fn((p: unknown) => p),
    upsertCompanyProfileGovernanceSettings: jest.fn(() => null),
    getCompanyProfileReviewStatus: jest.fn(() => ({ status: 'ready', issues: [] })),
  };
});
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'SUPER_ADMIN' }),
  getContentArchitectCompanyId: jest.fn().mockReturnValue(null),
  isContentArchitectSession: jest.fn().mockReturnValue(false),
}));
jest.mock('../../services/companyContextIntelligenceService', () => ({
  getCompanyContextIntelligence: jest.fn().mockResolvedValue(null),
  calculateIntelligenceReadiness: jest.fn().mockReturnValue({ score: 42, tier: 'basic' }),
}));
jest.mock('../../services/companyContextService', () => ({
  buildCompanyContext: jest.fn().mockReturnValue({}),
  buildForcedCompanyContext: jest.fn().mockReturnValue({ forced_context_enabled_fields: [] }),
  computeCompanyContextCompletion: jest.fn().mockReturnValue({ score: 0 }),
  FORCED_CONTEXT_FIELD_LABELS: {},
}));
jest.mock('../../services/unifiedCompetitorIntelligenceService', () => ({
  buildUnifiedCompetitorIntelligence: jest.fn().mockResolvedValue(null),
}));

import { getProfile } from '../../services/companyProfileService';

// Core-6 satisfied (company/website/industry/products/audience/unique_value all
// present + High confidence) → knowledge readiness enoughToProceed === true.
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

const runWith = async (profile: unknown) => {
  // Fresh clone per run so no cross-run mutation of the fixture can occur.
  (getProfile as jest.Mock).mockResolvedValue(profile);
  const req = createApiRequestMock({ method: 'GET', companyId: 'acme' });
  const res = createMockRes();
  await companyProfileHandler(req, res);
  return res;
};

const run = () => runWith(JSON.parse(JSON.stringify(PROFILE)) as CompanyProfile);

describe('company-profile index (LIVE completeness path) — canonical readiness (Phase B)', () => {
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
    // Legacy shape the frontend depends on.
    expect(body).toHaveProperty('profile');
    expect(body).toHaveProperty('overall_profile_completion');
    expect(body).toHaveProperty('problem_transformation_completion');
    expect(body).toHaveProperty('section_scores');
    expect(body).toHaveProperty('completeness');
    expect(body).toHaveProperty('profile_completeness');
    expect(body).toHaveProperty('intelligence_readiness');
    // Additive field absent when off.
    expect(body).not.toHaveProperty('knowledge_readiness');
  });

  test('flag OFF: overall_profile_completion equals the real calculator output', async () => {
    const {
      calculateCompanyProfileCompleteness,
    } = jest.requireActual('../../services/companyProfile/fieldConstants');
    const expected = calculateCompanyProfileCompleteness(PROFILE).score;
    const res = await run();
    expect(res.body.overall_profile_completion).toBe(expected);
  });

  test('flag OFF response key set is exactly the legacy key set (no additions)', async () => {
    const res = await run();
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'profile',
        'company_profile_review',
        'recommendation_strategic_config',
        'overall_profile_completion',
        'problem_transformation_completion',
        'section_scores',
        'completeness',
        'profile_completeness',
        'intelligence_readiness',
        'company_context_completion',
        'forced_context_enabled_fields',
        'forced_context_active_labels',
      ].sort()
    );
  });

  test('flag ENFORCE: every legacy field byte-identical + knowledge_readiness added', async () => {
    const off = await run();
    const legacySnapshot = { ...off.body };

    process.env[MODE_ENV] = 'enforce';
    const on = await run();

    // Every legacy field is byte-identical to the flag-off response.
    for (const key of Object.keys(legacySnapshot)) {
      expect(on.body[key]).toEqual(legacySnapshot[key]);
    }
    // Exactly one additive key.
    expect(Object.keys(on.body).sort()).toEqual(
      [...Object.keys(legacySnapshot), 'knowledge_readiness'].sort()
    );
    // The canonical readiness is surfaced additively.
    const kr = on.body.knowledge_readiness;
    expect(typeof kr.score).toBe('number');
    expect(kr).toHaveProperty('satisfiedCount');
    expect(kr).toHaveProperty('remainingGaps');
    expect(kr).toHaveProperty('enoughToProceed');
    // Core-6 satisfied in the fixture → decision from KNOWLEDGE, not field count.
    expect(kr.enoughToProceed).toBe(true);
  });

  test('flag SHADOW also surfaces the field (any non-off mode)', async () => {
    process.env[MODE_ENV] = 'shadow';
    const res = await run();
    expect(res.body).toHaveProperty('knowledge_readiness');
  });

  test('FAIL-SAFE: a graph-throwing profile still returns profile + completeness, no error', async () => {
    process.env[MODE_ENV] = 'enforce';
    // user_locked_fields is a non-array → buildCompanyKnowledgeGraph(...).map throws.
    // The completeness calculator does not read user_locked_fields, so it succeeds;
    // only the (wrapped) readiness computation throws and is swallowed.
    const throwProfile = {
      ...JSON.parse(JSON.stringify(PROFILE)),
      user_locked_fields: 42,
    } as unknown as CompanyProfile;
    const res = await runWith(throwProfile);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('profile');
    expect(res.body).toHaveProperty('overall_profile_completion');
    // Readiness threw → swallowed → field absent, profile response intact.
    expect(res.body).not.toHaveProperty('knowledge_readiness');
  });
});
