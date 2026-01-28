import { buildPlatformExecutionPlan } from '../../services/platformIntelligenceService';
import { buildSchedulerPayload } from '../../services/schedulerPayloadBuilder';
import { validateCampaignHealth } from '../../services/campaignHealthService';

describe('Platform execution plan', () => {
  const profile: any = {
    company_id: 'comp-1',
    industry_list: ['ai'],
    content_themes_list: ['growth', 'productivity'],
    target_audience_list: ['founders'],
    goals_list: ['engagement'],
    social_profiles: [
      { platform: 'LinkedIn', url: 'https://linkedin.com/company/test' },
      { platform: 'Instagram', url: 'https://instagram.com/test' },
      { platform: 'X', url: 'https://x.com/test' },
    ],
  };

  const weekPlan: any = {
    week_number: 1,
    theme: 'Growth Systems',
    platforms: ['LinkedIn', 'Instagram', 'X'],
    content_types: {
      linkedin: ['text'],
      instagram: ['video'],
      x: ['text'],
    },
  };

  it('alternates platforms and suggests times', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
    });
    expect(plan.days.length).toBe(7);
    expect(plan.days[0].platform).not.toBe(plan.days[1].platform);
    expect(plan.days[0].suggestedTime).toBeTruthy();
  });

  it('creates placeholders for video or audio', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
    });
    const placeholders = plan.days.filter((day) => day.placeholder);
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it('attaches trends when aligned', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: ['growth loops', 'productivity hacks'],
    });
    expect(plan.days.some((day) => day.trendUsed)).toBe(true);
  });

  it('builds scheduler payload', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
    });
    const payload = buildSchedulerPayload({ platformExecutionPlan: plan });
    expect(payload.jobs.length).toBe(plan.days.length);
  });

  it('downgrades health when placeholders exceed 30%', () => {
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: { objective: 'engagement' },
      weekPlan,
      trends: [],
    });
    const report = validateCampaignHealth({
      companyProfile: profile,
      trends: [],
      campaign: {},
      weeklyPlans: [weekPlan],
      dailyPlans: [
        {
          date: 'Week 1 Day 1',
          platform: 'linkedin',
          content_type: 'text',
          trend_alignment: true,
          schedule_hint: { best_day: 'Tuesday', best_time: '09:00', confidence: 70 },
          source: 'new',
        },
        {
          date: 'Week 1 Day 2',
          platform: 'instagram',
          content_type: 'image',
          trend_alignment: true,
          schedule_hint: { best_day: 'Wednesday', best_time: '19:00', confidence: 70 },
          source: 'new',
        },
        {
          date: 'Week 1 Day 3',
          platform: 'x',
          content_type: 'text',
          trend_alignment: false,
          schedule_hint: { best_day: 'Thursday', best_time: '12:00', confidence: 70 },
          source: 'new',
        },
      ],
      platformExecutionPlan: plan,
      contentAssets: [
        { status: 'approved', current_version: 1 },
        { status: 'approved', current_version: 1 },
      ],
      analyticsReport: { engagementRate: 0.9 },
      learningInsights: { recommendations: [{ confidence: 80 }] },
    });
    expect(report.status).toBe('warning');
  });
});
