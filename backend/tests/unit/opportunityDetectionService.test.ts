import { runInBackgroundJobContext } from '../../services/intelligenceExecutionContext';
import {
  detectOpportunities,
  type OpportunityDetectionInput,
} from '../../services/opportunityDetectionService';

jest.mock('../../services/marketingMemoryService', () => ({
  getMarketingMemoriesByType: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/decisionObjectService', () => ({
  archiveDecisionScope: jest.fn().mockResolvedValue(undefined),
  getLatestDecisionObjectsForSource: jest.fn().mockResolvedValue(null),
  replaceDecisionObjectsForSource: jest.fn(async (inputs: any[]) =>
    inputs.map((input, index) => ({
      ...input,
      id: `00000000-0000-0000-0000-00000000001${index + 1}`,
      execution_score: 3.1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      resolved_at: null,
      ignored_at: null,
    }))
  ),
}));

const COMPANY_ID = '33333333-3333-4333-8333-333333333333';

describe('opportunityDetectionService', () => {
  it('returns decision objects only', async () => {
    const input: OpportunityDetectionInput = {
      company_id: COMPANY_ID,
      trend_signals: [
        { snapshot: { emerging_trends: [{ topic: 'AI automation', strength: 0.8 }] } },
      ],
      engagement_health_report: { engagement_rate: 0.2 },
      strategic_insight_report: { insights: [] },
      inbox_signals: [{ latest_message: 'automation automation pipeline' }],
    };

    const decisions = await runInBackgroundJobContext('test.opportunity', () => detectOpportunities(input));
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0]).toMatchObject({
      company_id: COMPANY_ID,
      entity_type: 'global',
      source_service: 'opportunityDetectionService',
      report_tier: 'growth',
      status: 'open',
    });
  });

  it('rejects non-background execution', async () => {
    const input: OpportunityDetectionInput = {
      company_id: COMPANY_ID,
      trend_signals: [],
      engagement_health_report: null,
      strategic_insight_report: null,
      inbox_signals: [],
    };

    await expect(detectOpportunities(input)).rejects.toThrow('background job context');
  });
});
