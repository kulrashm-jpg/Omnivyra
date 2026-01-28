import { buildSchedulerPayload } from '../../services/schedulerPayloadBuilder';
import { validateCampaignHealth } from '../../services/campaignHealthService';
import {
  approveContentAsset,
  createContentAsset,
  regenerateContentAsset,
} from '../../services/contentAssetService';
import { generateContentForDay } from '../../services/contentGenerationService';

jest.mock('../../db/contentAssetStore', () => {
  const assets = new Map<string, any>();
  const versions = new Map<string, any[]>();
  return {
    createContentAsset: jest.fn(async (input: any) => {
      const asset_id = `asset-${assets.size + 1}`;
      const asset = {
        asset_id,
        campaign_id: input.campaignId,
        week_number: input.weekNumber,
        day: input.day,
        platform: input.platform,
        status: 'draft',
        current_version: 1,
      };
      assets.set(asset_id, asset);
      versions.set(asset_id, []);
      return asset;
    }),
    getContentAssetByKey: jest.fn(async () => null),
    getContentAssetById: jest.fn(async (id: string) => assets.get(id) || null),
    listContentAssets: jest.fn(async () => Array.from(assets.values())),
    createContentVersion: jest.fn(async (input: any) => {
      const list = versions.get(input.assetId) || [];
      const version = { version: input.version, content_json: input.content };
      list.push(version);
      versions.set(input.assetId, list);
      return version;
    }),
    listContentVersions: jest.fn(async (id: string) => versions.get(id) || []),
    updateContentAssetStatus: jest.fn(async (input: any) => {
      const asset = assets.get(input.assetId);
      if (asset) {
        asset.status = input.status ?? asset.status;
        if (input.currentVersion) asset.current_version = input.currentVersion;
      }
      return asset;
    }),
    createContentReview: jest.fn(async () => ({})),
  };
});

jest.mock('openai', () => {
  return class OpenAI {
    chat = {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  headline: 'Headline',
                  caption: 'Caption',
                  hook: 'Hook',
                  callToAction: 'CTA',
                  hashtags: ['#test'],
                  tone: 'professional',
                  reasoning: 'Aligned with campaign',
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

describe('Content pipeline', () => {
  const profile: any = {
    company_id: 'comp-1',
    brand_voice_list: ['professional'],
    target_audience_list: ['founders'],
    content_themes_list: ['growth'],
  };
  const campaign: any = { objective: 'engagement' };
  const weekPlan: any = { week_number: 1, theme: 'Growth Systems' };
  const dayPlan: any = {
    date: 'Week 1 Day 1',
    platform: 'linkedin',
    theme: 'Growth Systems',
    trendUsed: null,
  };

  it('generates content for a day', async () => {
    const content = await generateContentForDay({
      companyProfile: profile,
      campaign,
      weekPlan,
      dayPlan,
      trend: null,
      platform: 'linkedin',
    });
    expect(content.caption).toBe('Caption');
  });

  it('creates and regenerates content asset versions', async () => {
    const asset = await createContentAsset({
      campaignId: 'camp-1',
      weekNumber: 1,
      day: 'Week 1 Day 1',
      platform: 'linkedin',
      content: { caption: 'v1' },
    });
    const updated = await regenerateContentAsset({
      assetId: asset.asset.asset_id,
      instruction: 'make it shorter',
    });
    expect(updated.asset.current_version).toBe(2);
  });

  it('approval flow works', async () => {
    const asset = await createContentAsset({
      campaignId: 'camp-1',
      weekNumber: 1,
      day: 'Week 1 Day 2',
      platform: 'linkedin',
      content: { caption: 'v1' },
    });
    const reviewed = await approveContentAsset({ assetId: asset.asset.asset_id });
    expect(reviewed.status).toBe('reviewed');
    const approved = await approveContentAsset({ assetId: asset.asset.asset_id });
    expect(approved.status).toBe('approved');
  });

  it('scheduler payload includes approved content', async () => {
    const payload = buildSchedulerPayload({
      platformExecutionPlan: {
        weekNumber: 1,
        days: [
          {
            date: 'Week 1 Day 1',
            platform: 'linkedin',
            contentType: 'text',
            theme: 'Growth',
            placeholder: false,
            suggestedTime: '09:00',
            reasoning: 'Aligned',
          },
        ],
        frequencySummary: { linkedin: 1 },
      },
      approvedAssets: [
        {
          asset_id: 'asset-1',
          day: 'Week 1 Day 1',
          platform: 'linkedin',
          latest_content: { caption: 'Caption' },
        },
      ],
    });
    expect(payload.jobs.length).toBe(1);
    expect(payload.jobs[0].contentAssetId).toBe('asset-1');
  });

  it('health flags unapproved assets', () => {
    const report = validateCampaignHealth({
      companyProfile: { ...profile, industry_list: ['ai'], goals_list: ['engagement'] },
      trends: [],
      campaign: {},
      weeklyPlans: [weekPlan],
      dailyPlans: [
        {
          platform: 'linkedin',
          content_type: 'text',
          trend_alignment: true,
          schedule_hint: { best_day: 'Tuesday', best_time: '09:00', confidence: 70 },
          source: 'new',
        },
      ],
      contentAssets: [
        {
          status: 'draft',
          current_version: 1,
        },
      ],
    });
    expect(report.status).toBe('blocked');
  });
});
