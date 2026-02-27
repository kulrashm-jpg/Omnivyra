import handler from '../../../pages/api/campaigns/ai/plan';
import { saveAiCampaignPlan } from '../../db/campaignPlanStore';
import { assessVirality } from '../../services/viralityAdvisorService';
import { requestDecision } from '../../services/omnivyreClient';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/campaignPlanStore', () => ({
  saveAiCampaignPlan: jest.fn(),
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
    content_type_mix: ['5 post', '2 video', '1 blog'],
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
            objective: 'Test objective',
            cta_type: 'Soft CTA',
            target_audience: 'Professionals',
            writing_angle: 'clear, practical',
            brief_summary: 'Test brief',
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

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockImplementation((args: any) => {
            if (args?.response_format?.type === 'json_object') {
              const weeks = Array.from({ length: 12 }, (_, idx) => {
                const week = idx + 1;
                return {
                  week,
                  phase_label: `Week ${week}`,
                  primary_objective: `Objective ${week}`,
                  platform_allocation: { linkedin: 8 },
                  content_type_mix: ['8 post'],
                  cta_type: 'Soft CTA',
                  total_weekly_content_count: 8,
                  weekly_kpi_focus: 'Reach growth',
                  theme: `Theme ${week}`,
                  topics_to_cover: [`Topic ${week}`],
                  daily: [],
                };
              });
              return Promise.resolve({
                choices: [{ message: { content: JSON.stringify({ weeks }) } }],
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

describe('Campaign AI Plan Persist', () => {
  it('persists raw plan output', async () => {
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
          content_capacity: { post: 5, video: 2, blog: 1, story: 0, thread: 0 },
          campaign_duration: 12,
          platforms: 'linkedin',
          platform_content_requests: { linkedin: { post: 5, video: 2, blog: 1 } },
          exclusive_campaigns: [],
          key_messages: 'Test key messages',
        },
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    await handler(req, res);

    expect(saveAiCampaignPlan).toHaveBeenCalledWith({
      campaignId: 'camp123',
      snapshot_hash: 'hash123',
      mode: 'generate_plan',
      response: 'Test campaign plan output',
      omnivyre_decision: expect.objectContaining({
        recommendation: 'HOLD',
      }),
    });
  });
});
