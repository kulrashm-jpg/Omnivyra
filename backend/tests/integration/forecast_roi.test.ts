import { generateCampaignForecast } from '../../services/campaignForecastService';
import { calculateROI } from '../../services/roiService';
import { buildExecutiveReport } from '../../services/businessIntelligenceService';

describe('Forecast & ROI', () => {
  it('generates forecast', async () => {
    const forecast = await generateCampaignForecast({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      campaignPlan: { weekly_plan: [{ week_number: 1, trend_influence: ['ai'] }] },
      platformExecutionPlan: { days: [{ platform: 'linkedin' }, { platform: 'x' }] },
      contentAssets: [],
      trendsUsed: ['ai'],
      campaignMemory: {},
      analyticsHistory: { engagementRate: 0.1 },
    });
    expect(forecast.expectedReach).toBeGreaterThan(0);
    expect(forecast.confidence).toBeGreaterThan(0);
  });

  it('calculates ROI', () => {
    const roi = calculateROI({
      campaignId: 'camp-1',
      costInputs: { adSpend: 100, productionCost: 50 },
      performanceMetrics: { totalValue: 300, platformValues: { linkedin: 200, x: 100 } },
    });
    expect(roi.roiPercent).toBeGreaterThan(0);
    expect(roi.bestPlatform).toBe('linkedin');
  });

  it('builds business report', async () => {
    const report = await buildExecutiveReport({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      companyProfile: { content_themes_list: ['ai'] },
      campaignPlan: { weekly_plan: [{ week_number: 1, trend_influence: [] }] },
      platformExecutionPlan: { days: [{ platform: 'linkedin' }] },
      contentAssets: [],
      trendsUsed: ['ai'],
      campaignMemory: { pastThemes: [] },
      analyticsHistory: { engagementRate: 0.1 },
      performanceMetrics: { totalValue: 100, platformValues: { linkedin: 100 } },
      costInputs: { adSpend: 50 },
      learningInsights: { recommendations: [{ message: 'test', confidence: 80 }] },
    });
    expect(report.summary).toContain('Forecast');
  });
});
