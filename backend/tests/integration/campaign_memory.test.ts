import { getCampaignMemory } from '../../services/campaignMemoryService';
import { detectContentOverlap } from '../../services/contentOverlapService';

jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersion: jest.fn().mockResolvedValue({
    campaign_snapshot: {
      weekly_plan: [{ theme: 'Growth' }],
      daily_plan: [{ topic: 'Lead gen' }],
    },
  }),
  getTrendSnapshots: jest.fn().mockResolvedValue([{ snapshot: { emerging_trends: [{ topic: 'ai' }] } }]),
}));
jest.mock('../../db/contentAssetStore', () => ({
  listAssetsWithLatestContent: jest.fn().mockResolvedValue([
    { latest_content: { hook: 'Hook', caption: 'Caption' } },
  ]),
}));
jest.mock('../../db/performanceStore', () => ({
  getLatestAnalyticsReport: jest.fn().mockResolvedValue({ report_json: {} }),
  getLatestLearningInsights: jest.fn().mockResolvedValue({ insights_json: {} }),
}));
jest.mock('../../db/campaignMemoryStore', () => ({
  saveCampaignMemorySnapshot: jest.fn(),
  saveContentSimilarityCheck: jest.fn(),
}));

describe('Campaign memory', () => {
  it('collects memory snapshot', async () => {
    const memory = await getCampaignMemory({ companyId: 'comp-1', campaignId: 'camp-1' });
    expect(memory.pastThemes).toContain('Growth');
    expect(memory.pastTopics).toContain('Lead gen');
  });

  it('detects overlap', async () => {
    const overlap = await detectContentOverlap({
      companyId: 'comp-1',
      newProposedContent: ['Growth'],
      campaignMemory: {
        pastThemes: ['Growth'],
        pastTopics: [],
        pastHooks: [],
        pastTrendsUsed: [],
        pastPlatforms: [],
        pastContentSummaries: [],
      },
    });
    expect(overlap.overlapDetected).toBe(true);
  });
});
