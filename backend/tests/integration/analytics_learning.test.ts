import { ingestPerformanceData } from '../../services/performanceIngestionService';
import { computeAnalytics } from '../../services/analyticsService';
import { generateLearningInsights } from '../../services/learningEngineService';
import { detectTrendDrift } from '../../services/trendDriftService';
import * as performanceStore from '../../db/performanceStore';
import * as contentAssetStore from '../../db/contentAssetStore';

jest.mock('../../db/performanceStore', () => ({
  upsertPerformanceMetric: jest.fn(),
  listPerformanceMetrics: jest.fn(),
  saveAnalyticsReport: jest.fn(),
  saveLearningInsights: jest.fn(),
}));
jest.mock('../../db/contentAssetStore', () => ({
  getContentAssetById: jest.fn(),
}));

describe('Analytics & Learning', () => {
  beforeEach(() => {
    (contentAssetStore.getContentAssetById as jest.Mock).mockResolvedValue({
      asset_id: 'asset-1',
      campaign_id: 'camp-1',
      week_number: 1,
      day: 'Week 1 Day 1',
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('ingests performance data', async () => {
    await ingestPerformanceData({
      platform: 'linkedin',
      contentAssetId: 'asset-1',
      metrics: { likes: 10, comments: 5, shares: 3, reach: 100 },
      capturedAt: '2026-01-01T00:00:00Z',
    });
    expect(performanceStore.upsertPerformanceMetric).toHaveBeenCalled();
  });

  it('computes analytics', async () => {
    (performanceStore.listPerformanceMetrics as jest.Mock).mockResolvedValue([
      {
        content_asset_id: 'asset-1',
        platform: 'linkedin',
        metrics_json: { likes: 10, comments: 5, shares: 5, reach: 100 },
      },
    ]);
    const report = await computeAnalytics({ companyId: 'comp-1', campaignId: 'camp-1' });
    expect(report.engagementRate).toBeGreaterThan(0);
  });

  it('generates learning insights', async () => {
    const insights = await generateLearningInsights({
      analytics: {
        engagementRate: 0.2,
        bestPlatforms: ['linkedin'],
        bestContentTypes: ['text'],
        bestTimes: ['09:00'],
        trendSuccess: [{ trend: 'ai', score: 0.9 }],
      },
      companyProfile: {},
      campaign: {},
      companyId: 'comp-1',
      campaignId: 'camp-1',
    });
    expect(insights.recommendations.length).toBeGreaterThan(0);
  });

  it('trend drift uses analytics to avoid poor trends', () => {
    const drift = detectTrendDrift({
      companyProfile: { content_themes_list: ['artificial intelligence'] } as any,
      previousTrends: [],
      newTrends: ['artificial intelligence trend', 'bad trend'],
      analytics: { trendSuccess: [{ trend: 'bad', score: 0.1 }] },
    });
    expect(drift.newTopics).toContain('artificial');
    expect(drift.newTopics).not.toContain('bad');
  });
});
