import { validateCampaignHealth } from '../../services/campaignHealthService';
import { detectTrendDrift } from '../../services/trendDriftService';
import * as campaignOptimizationService from '../../services/campaignOptimizationService';
import * as campaignVersionStore from '../../db/campaignVersionStore';
import * as companyProfileService from '../../services/companyProfileService';

jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersion: jest.fn(),
  saveOptimizationHistory: jest.fn(),
  saveWeekVersions: jest.fn(),
  saveCampaignVersion: jest.fn(),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(),
}));
jest.mock('openai', () => {
  return class OpenAI {
    chat = {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  optimized_week_plan: {
                    theme: 'Theme 1 optimized',
                    platforms: ['linkedin'],
                    frequency_per_platform: { linkedin: 3 },
                  },
                  change_summary: 'Updated theme',
                  confidence: 88,
                }),
              },
            },
          ],
        }),
      },
    };
    constructor() {}
  };
});

describe('Campaign health layer', () => {
  const baseProfile: any = {
    company_id: 'comp-1',
    industry_list: ['ai'],
    content_themes_list: ['productivity'],
    target_audience_list: ['founders'],
    geography_list: ['us'],
    goals_list: ['growth'],
    social_profiles: [{ platform: 'linkedin', url: 'https://linkedin.com/company/test' }],
  };

  const weeklyPlans = Array.from({ length: 12 }, (_, idx) => ({
    week_number: idx + 1,
    theme: `Theme ${idx + 1}`,
    trend_influence: [],
    platforms: ['linkedin', 'x'],
    content_types: {},
    frequency_per_platform: { linkedin: 3, x: 3 },
    existing_content_used: [],
    new_content_needed: [],
    ai_optimized: false,
    version: 1,
  }));

  const dailyPlans = Array.from({ length: 10 }, (_, idx) => ({
    date: `Week 1 Day ${idx + 1}`,
    platform: idx % 2 === 0 ? 'linkedin' : 'x',
    content_type: 'text',
    trend_alignment: idx % 2 === 0,
    schedule_hint: { best_day: 'Tuesday', best_time: '09:00', confidence: 70 },
    source: 'new',
  }));

  it('blocks when industry is missing', () => {
    const report = validateCampaignHealth({
      companyProfile: { ...baseProfile, industry_list: [] },
      trends: [],
      campaign: {},
      weeklyPlans,
      dailyPlans,
    });
    expect(report.status).toBe('blocked');
    expect(report.issues.some((issue) => issue.field === 'industry')).toBe(true);
  });

  it('warns when geography is missing', () => {
    const report = validateCampaignHealth({
      companyProfile: { ...baseProfile, geography_list: [] },
      trends: [],
      campaign: {},
      weeklyPlans,
      dailyPlans,
      contentAssets: [
        {
          status: 'approved',
          current_version: 1,
        },
      ],
    });
    expect(report.status).toBe('warning');
    expect(report.issues.some((issue) => issue.field === 'geography')).toBe(true);
  });

  it('warns when weekly plan has fewer than 12 weeks', () => {
    const report = validateCampaignHealth({
      companyProfile: baseProfile,
      trends: [],
      campaign: {},
      weeklyPlans: weeklyPlans.slice(0, 6),
      dailyPlans,
      contentAssets: [
        {
          status: 'approved',
          current_version: 1,
        },
      ],
    });
    expect(report.status).toBe('warning');
    expect(report.issues.some((issue) => issue.field === 'weeklyPlans')).toBe(true);
  });

  it('blocks when no daily plans exist', () => {
    const report = validateCampaignHealth({
      companyProfile: baseProfile,
      trends: [],
      campaign: {},
      weeklyPlans,
      dailyPlans: [],
    });
    expect(report.status).toBe('blocked');
    expect(report.issues.some((issue) => issue.field === 'dailyPlans')).toBe(true);
  });

  it('detects trend drift when new topics align', () => {
    const result = detectTrendDrift({
      companyProfile: {
        ...baseProfile,
        content_themes_list: ['artificial intelligence', 'productivity', 'growth'],
      },
      previousTrends: [],
      newTrends: ['productivity growth strategies', 'artificial intelligence coaching'],
    });
    expect(result.driftDetected).toBe(true);
    expect(result.newTopics.length).toBeGreaterThanOrEqual(2);
  });

  it('does not detect drift when new topics are unrelated', () => {
    const result = detectTrendDrift({
      companyProfile: baseProfile,
      previousTrends: ['ai productivity'],
      newTrends: ['sports highlights', 'movie trailers'],
    });
    expect(result.driftDetected).toBe(false);
  });
});

describe('Campaign week optimization', () => {
  beforeEach(() => {
    (companyProfileService.getProfile as jest.Mock).mockResolvedValue({
      company_id: 'comp-1',
      industry_list: ['ai'],
    });
    (campaignVersionStore.getLatestCampaignVersion as jest.Mock).mockResolvedValue({
      version: 1,
      campaign_snapshot: {
        weekly_plan: [
          { week_number: 1, theme: 'Theme 1', version: 1, ai_optimized: false },
          { week_number: 2, theme: 'Theme 2', version: 1, ai_optimized: false },
        ],
      },
      status: 'draft',
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('optimizes a week and stores history', async () => {
    const result = await campaignOptimizationService.optimizeCampaignWeek({
      companyId: 'comp-1',
      campaignId: 'camp-1',
      weekNumber: 1,
      reason: 'Improve engagement',
      campaignObjective: 'engagement',
      trendData: [],
    });

    expect(result.updated_week.theme).toBe('Theme 1 optimized');
    expect(result.confidence).toBe(88);
    expect(campaignVersionStore.saveOptimizationHistory).toHaveBeenCalled();
    expect(campaignVersionStore.saveWeekVersions).toHaveBeenCalled();
    expect(campaignVersionStore.saveCampaignVersion).toHaveBeenCalled();
  });
});
