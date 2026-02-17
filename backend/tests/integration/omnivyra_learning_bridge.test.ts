import { sendLearningSnapshot, getLearningStatus } from '../../services/omnivyraFeedbackService';
import { generateRecommendations } from '../../services/recommendationEngineService';
import { generateCampaignAuditReport } from '../../services/campaignAuditService';

jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn().mockResolvedValue({ company_id: 'comp-1', category: 'marketing' }),
  validateCompanyProfile: jest.fn().mockReturnValue({ status: 'ready', missing_fields: [] }),
}));
jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn().mockResolvedValue([
    { topic: 'AI marketing', source: 'YouTube Trends', signal_confidence: 0.9 },
  ]),
  getPlatformStrategies: jest.fn().mockResolvedValue([]),
  getEnabledApis: jest.fn().mockResolvedValue([{ id: 'api-1' }]),
  getExternalApiRuntimeSnapshot: jest.fn().mockResolvedValue({
    health_snapshot: [],
    cache_stats: { hits: 0, misses: 0 },
    rate_limited_sources: [],
    signal_confidence_summary: { average: 0.8, min: 0.7, max: 0.9 },
  }),
}));
jest.mock('../../services/campaignMemoryService', () => ({
  getCampaignMemory: jest.fn().mockResolvedValue({
    pastThemes: [],
    pastTopics: [],
    pastHooks: [],
    pastTrendsUsed: [],
    pastPlatforms: [],
    pastContentSummaries: [],
  }),
  validateUniqueness: jest.fn().mockResolvedValue({
    overlapDetected: false,
    overlappingItems: [],
    similarityScore: 0.1,
    recommendation: 'Content is sufficiently unique.',
  }),
}));
jest.mock('../../services/campaignRecommendationService', () => ({
  generateCampaignStrategy: jest.fn().mockResolvedValue({
    weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
    daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
  }),
}));
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmniVyraEnabled: jest.fn().mockReturnValue(true),
  getTrendRelevance: jest.fn().mockResolvedValue({
    status: 'ok',
    data: { relevant_trends: [{ topic: 'AI marketing' }], ignored_trends: [] },
  }),
  getTrendRanking: jest.fn().mockResolvedValue({
    status: 'ok',
    data: { ranked_trends: [{ topic: 'AI marketing' }] },
    confidence: 0.8,
    explanation: 'Ranked',
  }),
  getOmniVyraHealthReport: jest.fn().mockReturnValue({
    status: 'healthy',
    endpoints: {},
    avg_latency_ms: 0,
    success_rate: 1,
    last_error: null,
  }),
}));
jest.mock('../../services/trends/trendAlignmentService', () => ({
  buildTrendAssessments: jest.fn().mockResolvedValue([]),
  getTrendAlerts: jest.fn().mockReturnValue({ emerging_trends: [], status: 'silent' }),
}));
jest.mock('../../services/campaignHealthService', () => ({
  validateCampaignHealth: jest.fn().mockReturnValue({ status: 'healthy', issues: [], scores: {} }),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersion: jest.fn().mockResolvedValue({
    campaign_snapshot: {
      weekly_plan: [],
      daily_plan: [],
    },
  }),
  getOptimizationHistory: jest.fn().mockResolvedValue([]),
  getTrendSnapshots: jest.fn().mockResolvedValue([]),
  getWeekVersions: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../db/platformExecutionStore', () => ({
  getLatestPlatformExecutionPlan: jest.fn().mockResolvedValue({ plan_json: null }),
}));
jest.mock('../../db/contentAssetStore', () => ({
  listAssetsWithLatestContent: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../db/performanceStore', () => ({
  getLatestAnalyticsReport: jest.fn().mockResolvedValue(null),
  getLatestLearningInsights: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../db/forecastStore', () => ({
  getLatestForecast: jest.fn().mockResolvedValue(null),
  getLatestRoi: jest.fn().mockResolvedValue(null),
  getLatestBusinessReport: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../db/platformPromotionStore', () => ({
  getComplianceReport: jest.fn().mockResolvedValue(null),
  getPlatformVariant: jest.fn().mockResolvedValue(null),
  getPromotionMetadata: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../db/supabaseClient', () => {
  const chain = (data: any) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    filter: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
    then: (fn: (v: any) => any) => Promise.resolve({ data: Array.isArray(data) ? data : [data], error: null }).then(fn),
  });
  const from = jest.fn((table: string) => {
    if (table === 'campaign_versions') return chain([{ id: 'v1', company_id: 'comp-1', campaign_id: 'camp-1' }]);
    return chain([]);
  });
  return { supabase: { from, rpc: jest.fn().mockResolvedValue({ data: null, error: null }) } };
});
jest.mock('../../services/contentOverlapService', () => ({
  detectContentOverlap: jest.fn().mockResolvedValue({
    overlapDetected: false,
    overlappingItems: [],
    similarityScore: 0.1,
    recommendation: 'Content is sufficiently unique.',
  }),
}));

describe('OmniVyra learning bridge', () => {
  beforeEach(() => {
    process.env.OMNIVYRA_BASE_URL = 'https://omnivyra.test';
    process.env.USE_OMNIVYRA = 'true';
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const companyProfileService = require('../../services/companyProfileService');
    companyProfileService.getProfile.mockResolvedValue({ company_id: 'comp-1', category: 'marketing' });
    companyProfileService.validateCompanyProfile.mockReturnValue({ status: 'ready', missing_fields: [] });

    const externalApiService = require('../../services/externalApiService');
    externalApiService.fetchTrendsFromApis.mockResolvedValue([
      { topic: 'AI marketing', source: 'YouTube Trends', signal_confidence: 0.9 },
    ]);
    externalApiService.getPlatformStrategies.mockResolvedValue([]);
    externalApiService.getEnabledApis.mockResolvedValue([{ id: 'api-1' }]);
    externalApiService.getExternalApiRuntimeSnapshot.mockResolvedValue({
      health_snapshot: [],
      cache_stats: { hits: 0, misses: 0 },
      rate_limited_sources: [],
      signal_confidence_summary: { average: 0.8, min: 0.7, max: 0.9 },
    });

    const omnivyraClient = require('../../services/omnivyraClientV1');
    omnivyraClient.isOmniVyraEnabled.mockReturnValue(true);
    omnivyraClient.getTrendRelevance.mockResolvedValue({
      status: 'ok',
      data: { relevant_trends: [{ topic: 'AI marketing' }], ignored_trends: [] },
    });
    omnivyraClient.getTrendRanking.mockResolvedValue({
      status: 'ok',
      data: { ranked_trends: [{ topic: 'AI marketing' }] },
      confidence: 0.8,
      explanation: 'Ranked',
    });

    const campaignMemory = require('../../services/campaignMemoryService');
    campaignMemory.getCampaignMemory.mockResolvedValue({
      pastThemes: [],
      pastTopics: [],
      pastHooks: [],
      pastTrendsUsed: [],
      pastPlatforms: [],
      pastContentSummaries: [],
    });
    campaignMemory.validateUniqueness.mockResolvedValue({
      overlapDetected: false,
      overlappingItems: [],
      similarityScore: 0.1,
      recommendation: 'Content is sufficiently unique.',
    });

    const campaignRecommendation = require('../../services/campaignRecommendationService');
    campaignRecommendation.generateCampaignStrategy.mockResolvedValue({
      weekly_plan: [{ week_number: 1, theme: 'AI Marketing', trend_influence: [] }],
      daily_plan: [{ date: 'Week 1 Day 1', platform: 'linkedin', content_type: 'text', topic: 'AI' }],
    });

    const trendAlignment = require('../../services/trends/trendAlignmentService');
    trendAlignment.buildTrendAssessments.mockResolvedValue([]);
    trendAlignment.getTrendAlerts.mockReturnValue({ emerging_trends: [], status: 'silent' });

    const campaignHealth = require('../../services/campaignHealthService');
    campaignHealth.validateCampaignHealth.mockReturnValue({ status: 'healthy', issues: [], scores: {} });

    const campaignVersionStore = require('../../db/campaignVersionStore');
    campaignVersionStore.getLatestCampaignVersion.mockResolvedValue({
      campaign_snapshot: { weekly_plan: [], daily_plan: [] },
    });
    campaignVersionStore.getOptimizationHistory.mockResolvedValue([]);
    campaignVersionStore.getTrendSnapshots.mockResolvedValue([]);
    campaignVersionStore.getWeekVersions.mockResolvedValue([]);

    const platformExecutionStore = require('../../db/platformExecutionStore');
    platformExecutionStore.getLatestPlatformExecutionPlan.mockResolvedValue({ plan_json: null });

    const contentAssetStore = require('../../db/contentAssetStore');
    contentAssetStore.listAssetsWithLatestContent.mockResolvedValue([]);

    const performanceStore = require('../../db/performanceStore');
    performanceStore.getLatestAnalyticsReport.mockResolvedValue(null);
    performanceStore.getLatestLearningInsights.mockResolvedValue(null);

    const forecastStore = require('../../db/forecastStore');
    forecastStore.getLatestForecast.mockResolvedValue(null);
    forecastStore.getLatestRoi.mockResolvedValue(null);
    forecastStore.getLatestBusinessReport.mockResolvedValue(null);

    const platformPromotionStore = require('../../db/platformPromotionStore');
    platformPromotionStore.getComplianceReport.mockResolvedValue(null);
    platformPromotionStore.getPlatformVariant.mockResolvedValue(null);
    platformPromotionStore.getPromotionMetadata.mockResolvedValue(null);

    const overlapService = require('../../services/contentOverlapService');
    overlapService.detectContentOverlap.mockResolvedValue({
      overlapDetected: false,
      overlappingItems: [],
      similarityScore: 0.1,
      recommendation: 'Content is sufficiently unique.',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OMNIVYRA_BASE_URL;
    delete process.env.USE_OMNIVYRA;
  });

  it('sends learning payload when flag enabled', async () => {
    const result = await sendLearningSnapshot({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      trends_used: [{ topic: 'AI marketing', source: 'YouTube Trends', signal_confidence: 0.9 }],
      trends_ignored: [],
      signal_confidence_summary: { average: 0.8, min: 0.7, max: 0.9 },
      novelty_score: 0.2,
      confidence_score: 80,
      placeholders: [],
      explanation: 'Test',
      external_api_health_snapshot: [],
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('sent');
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('skips when flag disabled', async () => {
    process.env.USE_OMNIVYRA = 'false';
    const result = await sendLearningSnapshot({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      trends_used: [],
      trends_ignored: [],
      signal_confidence_summary: null,
      novelty_score: 0.2,
      confidence_score: 80,
      placeholders: [],
      explanation: 'Test',
      external_api_health_snapshot: [],
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('skipped');
  });

  it('marks failure when OmniVyra is unreachable', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await sendLearningSnapshot({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      trends_used: [],
      trends_ignored: [],
      signal_confidence_summary: null,
      novelty_score: 0.2,
      confidence_score: 80,
      placeholders: [],
      explanation: 'Test',
      external_api_health_snapshot: [],
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe('failed');
  });

  it('injects learning status into recommendation engine result', async () => {
    const result = await generateRecommendations({
      companyId: 'comp-1',
      campaignId: 'camp-1',
    });
    expect(result.omnivyra_learning?.status).toBeDefined();
  });

  it('exposes learning payload in audit report', async () => {
    await sendLearningSnapshot({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      trends_used: [],
      trends_ignored: [],
      signal_confidence_summary: null,
      novelty_score: 0.2,
      confidence_score: 80,
      placeholders: [],
      explanation: 'Test',
      external_api_health_snapshot: [],
      timestamp: new Date().toISOString(),
    });
    const status = getLearningStatus('camp-1');
    const report = await generateCampaignAuditReport('comp-1', 'camp-1');
    expect(report.omnivyra_learning_sent).toBe(status?.status === 'sent');
    expect(report.omnivyra_learning_payload_preview).toBeDefined();
  });
});
