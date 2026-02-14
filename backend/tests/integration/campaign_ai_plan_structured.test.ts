import handler from '../../../pages/api/campaigns/ai/plan';
import { saveStructuredCampaignPlan } from '../../db/campaignPlanStore';
import { assessVirality } from '../../services/viralityAdvisorService';
import { requestDecision } from '../../services/omnivyreClient';
import { parseAiPlanToWeeks } from '../../services/campaignPlanParser';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/campaignPlanStore', () => ({
  saveStructuredCampaignPlan: jest.fn(),
}));

jest.mock('../../services/viralityAdvisorService', () => ({
  assessVirality: jest.fn(),
}));

jest.mock('../../services/omnivyreClient', () => ({
  requestDecision: jest.fn(),
  buildDecideRequest: jest.fn((payload: any) => payload),
}));

jest.mock('../../services/viralitySnapshotBuilder', () => ({
  buildCampaignSnapshotWithHash: jest.fn().mockResolvedValue({
    snapshot: {
      snapshot_id: 'snap123',
      domain_type: 'campaign',
      state_payload: { campaign_id: 'camp123' },
      metadata: { owner_id: 'test' },
      timestamp: '2026-01-01T00:00:00Z',
    },
    snapshot_hash: 'hash123',
  }),
  canonicalJsonStringify: jest.fn((v) => JSON.stringify(v)),
}));

jest.mock('../../services/campaignPlanParser', () => ({
  parseAiPlanToWeeks: jest.fn(),
}));

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Test campaign plan output' } }],
          }),
        },
      },
    })),
  };
});

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Campaign AI Plan Structured', () => {
  it('persists and returns structured plan', async () => {
    (assessVirality as jest.Mock).mockResolvedValue({
      snapshot_hash: 'hash123',
      model_version: 'v1',
      diagnostics: {
        asset_coverage: {},
        platform_opportunity: {},
        engagement_readiness: {},
      },
      comparisons: {},
      overall_summary: 'ok',
    });

    (requestDecision as jest.Mock).mockResolvedValue({
      decision_id: 'dec123',
      recommendation: 'HOLD',
      confidence: 0.7,
      explanation: 'test explanation',
      guardrails_triggered: [],
      required_actions: [],
      trace_id: 'trace123',
      policy_version: 'default',
      timestamp: '2026-01-01T00:00:00Z',
    });

    (parseAiPlanToWeeks as jest.Mock).mockResolvedValue({
      weeks: [
        {
          week: 1,
          theme: 'Launch',
          phase_label: 'Launch',
          primary_objective: '',
          platform_allocation: {},
          content_type_mix: [],
          cta_type: 'None',
          total_weekly_content_count: 0,
          weekly_kpi_focus: 'Reach growth',
          daily: [
            {
              day: 'Monday',
              objective: 'Introduce campaign',
              content: 'Post announcement',
              platforms: { linkedin: 'Post announcement' },
              hashtags: ['launch', 'brand'],
              seo_keywords: ['launch strategy', 'brand awareness'],
              meta_title: 'Launch Week',
              meta_description: 'Kickoff content plan',
              hook: 'Start strong',
              cta: 'Learn more',
              best_time: '09:00',
              effort_score: 3,
              success_projection: 78,
            },
          ],
        },
      ],
    });

    const req = {
      method: 'POST',
      body: {
        campaignId: 'camp123',
        mode: 'generate_plan',
        message: 'Generate 12 week plan',
        durationWeeks: 12,
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    await handler(req, res);

    expect(saveStructuredCampaignPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp123',
        snapshot_hash: 'hash123',
        weeks: expect.arrayContaining([
          expect.objectContaining({
            week: 1,
            theme: 'Launch',
            daily: expect.any(Array),
          }),
        ]),
        omnivyre_decision: expect.objectContaining({
          recommendation: 'HOLD',
        }),
        raw_plan_text: 'Test campaign plan output',
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.plan).toBeDefined();
    expect(payload.plan.weeks).toBeDefined();
    expect(payload.plan.weeks.length).toBeGreaterThan(0);
    expect(payload.plan.weeks[0].week).toBe(1);
    expect(payload.plan.weeks[0].theme || payload.plan.weeks[0].phase_label).toBe('Launch');
  });
});
