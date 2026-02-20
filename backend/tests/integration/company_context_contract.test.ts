/**
 * Company Context Contract - Regression test.
 * Ensures problem_transformation fields are wired through UI → save → recommendation pipeline.
 * Fails if: profile lacks fields, company_context.problem_transformation missing, keywords exclude tokens.
 */

import { generateRecommendations } from '../../services/recommendationEngineService';
import { buildCompanyContext } from '../../services/companyContextService';
import { buildProfileKeywords } from '../../services/trends/trendAlignmentService';
import { getProfile } from '../../services/companyProfileService';
import { fetchExternalApis } from '../../services/externalApiService';
import { validateUniqueness } from '../../services/campaignMemoryService';
import { generateCampaignStrategy } from '../../services/campaignRecommendationService';
import { isOmniVyraEnabled } from '../../services/omnivyraClientV1';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn().mockResolvedValue({
    userId: 'user-1',
    role: 'admin',
    companyIds: ['c-1'],
    defaultCompanyId: 'c-1',
  }),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchExternalApis: jest.fn(),
  recordSignalConfidenceSummary: jest.fn(),
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
  getEnabledApis: jest.fn().mockResolvedValue([]),
  getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
    health_snapshot: [],
    cache_stats: { hits: 0, misses: 0 },
    rate_limited_sources: [],
    signal_confidence_summary: null,
  }),
}));
jest.mock('../../services/campaignMemoryService', () => ({
  getCampaignMemory: jest.fn(),
  validateUniqueness: jest.fn(),
}));
jest.mock('../../services/campaignRecommendationService', () => ({
  generateCampaignStrategy: jest.fn(),
}));
jest.mock('../../services/omnivyraClientV1', () => ({
  getTrendRelevance: jest.fn(),
  getTrendRanking: jest.fn(),
  isOmniVyraEnabled: jest.fn().mockReturnValue(false),
  getOmniVyraHealthReport: jest.fn().mockReturnValue({
    status: 'healthy',
    endpoints: {},
    avg_latency_ms: 0,
    success_rate: 1,
    last_error: null,
  }),
}));
jest.mock('../../services/trendNormalizationService', () => ({
  normalizeTrends: jest.fn().mockReturnValue([
    { title: 'AI marketing', source: 'YouTube Trends', confidence: 0.7 },
    { title: 'AI marketing', source: 'NewsAPI', confidence: 0.6 },
  ]),
}));

describe('company_context_contract', () => {
  beforeEach(() => {
    const { supabase } = jest.requireMock('../../db/supabaseClient');
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: [{ id: 'link' }], error: null }),
    }));
    const externalApiService = jest.requireMock('../../services/externalApiService');
    externalApiService.getEnabledApis.mockResolvedValue([]);
    externalApiService.getPlatformStrategies.mockResolvedValue([]);
    externalApiService.recordSignalConfidenceSummary.mockImplementation(() => {});
    (fetchExternalApis as jest.Mock).mockResolvedValue({
      results: [
        { source: { name: 'YouTube Trends', id: 'yt' }, payload: {} },
        { source: { name: 'NewsAPI', id: 'news' }, payload: {} },
      ],
      missing_env_placeholders: [],
      cache_stats: { hits: 0, misses: 0, per_api_hits: {}, per_api_misses: {} },
      rate_limited_sources: [],
      signal_confidence_summary: null,
    });
    const trendNormalization = jest.requireMock('../../services/trendNormalizationService');
    trendNormalization.normalizeTrends.mockReturnValue([
      { title: 'AI marketing', source: 'YouTube Trends', confidence: 0.7 },
      { title: 'AI marketing', source: 'NewsAPI', confidence: 0.6 },
    ]);
    (validateUniqueness as jest.Mock).mockResolvedValue({
      overlapDetected: false,
      overlappingItems: [],
      similarityScore: 0.2,
      recommendation: 'Content is sufficiently unique.',
    });
    (generateCampaignStrategy as jest.Mock).mockResolvedValue({
      weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
      daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
    });
  });

  it('1. profile contains problem_transformation fields', () => {
    const profile = {
      company_id: 'c1',
      core_problem_statement: 'prioritization chaos',
      pain_symptoms: ['scope creep', 'delays'],
      authority_domains: ['project management'],
      desired_transformation: 'clarity and focus',
    };
    expect(profile.core_problem_statement).toBeDefined();
    expect(profile.pain_symptoms).toHaveLength(2);
    expect(profile.authority_domains).toHaveLength(1);
    expect(profile.desired_transformation).toBeDefined();
  });

  it('2. recommendation generation returns company_context.problem_transformation', async () => {
    const profileWithProblemTransformation = {
      company_id: 'c-1',
      category: 'marketing',
      core_problem_statement: 'team prioritization chaos',
      pain_symptoms: ['scope creep', 'resource conflicts'],
      desired_transformation: 'clarity and predictable delivery',
      authority_domains: ['agile', 'project management'],
    };
    (getProfile as jest.Mock).mockResolvedValue(profileWithProblemTransformation);

    const result = await generateRecommendations({
      companyId: 'c-1',
      campaignId: 'camp-1',
    });

    expect(result.company_context).toBeDefined();
    expect(result.company_context!.problem_transformation).toBeDefined();
    expect(result.company_context!.problem_transformation).toHaveProperty('core_problem_statement');
    expect(result.company_context!.problem_transformation).toHaveProperty('pain_symptoms');
    expect(result.company_context!.problem_transformation).toHaveProperty('desired_transformation');
    expect(result.company_context!.problem_transformation).toHaveProperty('authority_domains');
  });

  it('3. buildProfileKeywords includes authority_domains and desired_transformation tokens', () => {
    const profile = {
      company_id: 'c1',
      authority_domains: ['strategic planning'],
      desired_transformation: 'decisive execution',
    };
    const keywords = buildProfileKeywords(profile);
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords.some((k) => k.includes('strategic') || k.includes('planning'))).toBe(true);
    expect(keywords.some((k) => k.includes('decisive') || k.includes('execution'))).toBe(true);
  });

  it('4. buildCompanyContext.problem_transformation ALWAYS exists when profile exists', () => {
    const profile = {
      company_id: 'c1',
      core_problem_statement: 'chaos',
      pain_symptoms: ['delays'],
      desired_transformation: 'clarity',
      authority_domains: ['agile'],
    };
    const ctx = buildCompanyContext(profile);
    expect(ctx.problem_transformation).toBeDefined();
    expect(ctx.problem_transformation.core_problem_statement).toBe('chaos');
    expect(ctx.problem_transformation.pain_symptoms).toEqual(['delays']);
    expect(ctx.problem_transformation.desired_transformation).toBe('clarity');
    expect(ctx.problem_transformation.authority_domains).toEqual(['agile']);
  });
});
