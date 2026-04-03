import { generateCampaignForecast } from '../../services/campaignForecastService';
import { calculateROI } from '../../services/roiService';
import { buildExecutiveReport } from '../../services/businessIntelligenceService';

jest.mock('../../services/decisionReportService', () => ({
  getDecisionReportView: jest.fn().mockResolvedValue({
    company_id: '11111111-1111-4111-8111-111111111111',
    report_tier: 'deep',
    entity_scope: {
      entity_type: 'campaign',
      entity_id: '22222222-2222-4222-8222-222222222222',
    },
    summary: {
      total: 1,
      open: 1,
      resolved: 0,
      ignored: 0,
      avg_confidence: 0.9,
      top_issue_types: [{ issue_type: 'negative_roi_risk', count: 1 }],
      top_action_types: [{ action_type: 'reallocate_budget', count: 1 }],
    },
    decisions: [{
      id: '44444444-4444-4444-8444-444444444444',
      company_id: '11111111-1111-4111-8111-111111111111',
      report_tier: 'deep',
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign',
      entity_id: '22222222-2222-4222-8222-222222222222',
      issue_type: 'negative_roi_risk',
      title: 'Forecasted ROI is negative',
      description: 'Forecast indicates poor return.',
      evidence: { roi_percent: -10 },
      impact_traffic: 20,
      impact_conversion: 50,
      impact_revenue: 80,
      priority_score: 80,
      effort_score: 30,
      execution_score: 2.66,
      confidence_score: 0.9,
      recommendation: 'Reallocate budget.',
      action_type: 'reallocate_budget',
      action_payload: { campaign_id: '22222222-2222-4222-8222-222222222222' },
      status: 'open',
      last_changed_by: 'system',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      resolved_at: null,
      ignored_at: null,
    }],
  }),
}));

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

  it('builds business report from decision views only', async () => {
    const report = await buildExecutiveReport({
      companyId: '11111111-1111-4111-8111-111111111111',
      campaignId: '22222222-2222-4222-8222-222222222222',
      companyProfile: {},
      campaignPlan: {},
    });
    expect(report.summary).toContain('Forecast');
    expect(report.report_view.report_tier).toBe('deep');
    expect(report.report_view.decisions[0].action_type).toBe('reallocate_budget');
  });
});
