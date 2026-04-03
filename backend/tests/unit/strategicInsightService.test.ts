import { runInBackgroundJobContext } from '../../services/intelligenceExecutionContext';
import {
  generateStrategicInsights,
  type StrategicInsightInput,
} from '../../services/strategicInsightService';

jest.mock('../../services/marketingMemoryService', () => ({
  getMarketingMemoriesByType: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/decisionObjectService', () => ({
  archiveDecisionScope: jest.fn().mockResolvedValue(undefined),
  getLatestDecisionObjectsForSource: jest.fn().mockResolvedValue(null),
  replaceDecisionObjectsForSource: jest.fn(async (inputs: any[]) =>
    inputs.map((input, index) => ({
      ...input,
      id: `00000000-0000-0000-0000-00000000000${index + 1}`,
      execution_score: 2.5,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      resolved_at: null,
      ignored_at: null,
    }))
  ),
}));

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';

describe('strategicInsightService', () => {
  it('returns decision objects only', async () => {
    const input: StrategicInsightInput = {
      company_id: COMPANY_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_health_report: {
        health_flags: { has_metadata_issues: true },
        health_score: 35,
      },
      engagement_health_report: { engagement_rate: 0.01 },
      trend_signals: [{ snapshot: { emerging_trends: [{ topic: 'AI automation' }] } }],
      inbox_signals: [{ thread_id: 't-1' }],
    };

    const decisions = await runInBackgroundJobContext('test.strategic', () => generateStrategicInsights(input));
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0]).toMatchObject({
      company_id: COMPANY_ID,
      entity_type: 'campaign',
      entity_id: CAMPAIGN_ID,
      source_service: 'strategicInsightService',
      report_tier: 'growth',
      status: 'open',
    });
  });

  it('rejects non-background execution', async () => {
    const input: StrategicInsightInput = {
      company_id: COMPANY_ID,
      campaign_id: CAMPAIGN_ID,
      campaign_health_report: null,
      engagement_health_report: { engagement_rate: 0.1 },
      trend_signals: [],
      inbox_signals: [],
    };

    await expect(generateStrategicInsights(input)).rejects.toThrow('background job context');
  });
});
