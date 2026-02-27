import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/campaignPlanStore', () => ({
  __esModule: true,
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

jest.mock('../../services/campaignPlanningInputsService', () => ({
  getCampaignPlanningInputs: jest.fn().mockResolvedValue(null),
  saveCampaignPlanningInputs: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/deterministicWeeklySkeleton', () => ({
  __esModule: true,
  buildDeterministicWeeklySkeleton: jest.fn().mockResolvedValue({
    total_weekly_content_count: 8,
    platform_allocation: { linkedin: 8 },
    content_type_mix: ['8 post'],
    execution_items: [
      {
        content_type: 'post',
        platform_options: ['linkedin'],
        selected_platforms: ['linkedin'],
        count_per_week: 8,
        topic_slots: Array.from({ length: 8 }, (_, idx) => ({
          topic: `Test topic ${idx + 1}`,
          progression_step: idx + 1,
          global_progression_index: idx + 1,
          intent: {
            objective: 'Launch objective',
            cta_type: 'None',
            target_audience: 'Professionals',
            writing_angle: 'clear, practical',
            brief_summary: 'Kickoff content plan',
            strategic_role: 'Authority Building',
            pain_point: 'Test pain',
            outcome_promise: 'Test outcome',
            audience_stage: 'problem_aware',
            recommendation_alignment: {
              source_type: 'primary_topic',
              source_value: 'Test',
              alignment_reason: 'Test',
            },
          },
        })),
      },
    ],
  }),
}));

jest.mock('../../services/campaignPlanParser', () => ({
  __esModule: true,
  parseAiPlanToWeeks: jest.fn(),
  parseAiRefinedDay: jest.fn(),
  parseAiPlatformCustomization: jest.fn(),
}));

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockImplementation((args: any) => {
            // campaignPlanParser.parseAiPlanToWeeks uses response_format: { type: 'json_object' }.
            // campaignAiOrchestrator plan generation does not.
            if (args?.response_format?.type === 'json_object') {
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        weeks: [
                          {
                            week: 1,
                            phase_label: 'Launch',
                            primary_objective: '',
                            platform_allocation: { linkedin: 1 },
                            content_type_mix: [],
                            cta_type: 'None',
                            total_weekly_content_count: 1,
                            weekly_kpi_focus: 'Reach growth',
                            theme: 'Launch',
                            topics_to_cover: ['Introduce campaign'],
                            daily: [
                              {
                                day: 'Monday',
                                objective: 'Introduce campaign',
                                content: 'Post announcement',
                                platforms: { linkedin: 'Post announcement' },
                              },
                            ],
                          },
                        ],
                      }),
                    },
                  },
                ],
              });
            }
            return Promise.resolve({
              choices: [{ message: { content: 'Test campaign plan output' } }],
            });
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
    const { assessVirality } = require('../../services/viralityAdvisorService');
    const { requestDecision } = require('../../services/omnivyreClient');
    const { parseAiPlanToWeeks } = require('../../services/campaignPlanParser');
    const { saveStructuredCampaignPlan } = require('../../db/campaignPlanStore');

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
      weeks: Array.from({ length: 12 }, (_, idx) => {
        const week = idx + 1;
        return {
          week,
          theme: week === 1 ? 'Launch' : `Week ${week} Theme`,
          phase_label: week === 1 ? 'Launch' : 'Audience Activation',
          primary_objective: week === 1 ? 'Launch objective' : `Objective for week ${week}`,
          platform_allocation: { linkedin: 8 },
          content_type_mix: ['8 post'],
          cta_type: 'None',
          total_weekly_content_count: 8,
          weekly_kpi_focus: 'Reach growth',
          daily:
            week === 1
              ? [
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
                ]
              : [],
        };
      }),
    });

    const req = {
      method: 'POST',
      body: {
        campaignId: 'camp123',
        companyId: 'comp123',
        mode: 'generate_plan',
        message: 'generate plan',
        durationWeeks: 12,
        collectedPlanningContext: {
          target_audience: 'Professionals',
          audience_professional_segment: 'Managers',
          communication_style: 'Professional & expert',
          action_expectation: 'Visit website',
          content_depth: 'Medium detail',
          topic_continuity: 'Mix of both',
          available_content: { post: 0, video: 0, blog: 0, story: 0, thread: 0 },
          tentative_start: '2026-08-15',
          content_capacity: { post: 8, video: 0, blog: 0, story: 0, thread: 0 },
          campaign_duration: 12,
          platforms: 'linkedin',
          platform_content_requests: { linkedin: { post: 8 } },
          exclusive_campaigns: [],
          key_messages: 'Test key messages',
        },
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    const handler = (await import('../../../pages/api/campaigns/ai/plan')).default;
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
