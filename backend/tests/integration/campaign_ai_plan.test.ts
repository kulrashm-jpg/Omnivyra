import handler from '../../../pages/api/campaigns/ai/plan';
import { assessVirality } from '../../services/viralityAdvisorService';
import { requestDecision } from '../../services/omnivyreClient';
import type { NextApiRequest, NextApiResponse } from 'next';

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

jest.mock('../../db/campaignPlanStore', () => ({
  saveAiCampaignPlan: jest.fn().mockResolvedValue(undefined),
  saveStructuredCampaignPlan: jest.fn().mockResolvedValue(undefined),
  saveStructuredCampaignPlanDayUpdate: jest.fn().mockResolvedValue(undefined),
  saveStructuredCampaignPlanPlatformCustomize: jest.fn().mockResolvedValue(undefined),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Campaign AI Plan API', () => {
  it('returns orchestrated response', async () => {
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
        mode: 'generate_plan',
        message: 'Generate 12 week plan',
        durationWeeks: 12,
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.mode).toBe('generate_plan');
    expect(payload.snapshot_hash).toBe('hash123');
    expect(String(payload.conversationalResponse || '')).toMatch(/Who will see your content\?|Who is your primary target audience\?/);
    expect(String(payload.conversationalResponse || '')).not.toContain('Required missing:');
    expect(payload.omnivyre_decision.recommendation).toBe('HOLD');
  });

  it('does not ask available_content when planning inputs exist', async () => {
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

    const { getCampaignPlanningInputs } = require('../../services/campaignPlanningInputsService');
    (getCampaignPlanningInputs as jest.Mock).mockResolvedValue({
      recommendation_snapshot: {},
      target_audience: 'Professionals',
      available_content: null,
      weekly_capacity: null,
      exclusive_campaigns: null,
      selected_platforms: null,
      platform_content_requests: null,
      planning_stage: 'campaign_planning_chat',
      is_completed: false,
    });

    const req = {
      method: 'POST',
      body: {
        campaignId: 'camp123',
        mode: 'generate_plan',
        message: 'hi',
        durationWeeks: 12,
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(String(payload.conversationalResponse || '')).toMatch(/which professionals are you mainly speaking to/i);
  });

  it('accepts tentative_start answer even when planning inputs exist', async () => {
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

    const { getCampaignPlanningInputs } = require('../../services/campaignPlanningInputsService');
    (getCampaignPlanningInputs as jest.Mock).mockResolvedValue({
      recommendation_snapshot: {},
      target_audience: 'Professionals',
      available_content: null,
      weekly_capacity: null,
      exclusive_campaigns: null,
      selected_platforms: null,
      platform_content_requests: null,
      planning_stage: 'campaign_planning_chat',
      is_completed: false,
    });

    const req = {
      method: 'POST',
      body: {
        campaignId: 'camp123',
        companyId: 'comp123',
        mode: 'generate_plan',
        message: '2026-03-23',
        durationWeeks: 12,
        messages: [
          { type: 'ai', message: 'When do you want to start the campaign? Please provide a date in YYYY-MM-DD format.' },
          { type: 'user', message: '2026-03-23' },
        ],
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    // Should move forward (not re-ask tentative_start).
    expect(String(payload.conversationalResponse || '')).not.toMatch(/yyyy-mm-dd/i);
    expect(String(payload.conversationalResponse || '')).not.toMatch(/start the campaign/i);
  });

  it('persists content breakdown inside JSONB buckets', async () => {
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

    const { saveCampaignPlanningInputs } = require('../../services/campaignPlanningInputsService');

    const req = {
      method: 'POST',
      body: {
        campaignId: 'camp123',
        companyId: 'comp123',
        mode: 'generate_plan',
        message: 'ok',
        durationWeeks: 12,
        messages: [
          { type: 'ai', message: 'Existing content: Do you have any existing content for this campaign?' },
          { type: 'user', message: '2 videos (reels), 1 videos (long-form), 3 posts (carousel)' },
          { type: 'ai', message: 'Content capacity: How much content can you produce per week?' },
          { type: 'user', message: '2 videos/week (reels), 1 videos/week (long-form), 3 posts/week (carousel)' },
        ],
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const call = (saveCampaignPlanningInputs as jest.Mock).mock.calls.find((c: any[]) => c?.[0]?.campaignId === 'camp123');
    expect(call).toBeTruthy();
    const payload = call[0];
    expect(payload.available_content).toEqual(
      expect.objectContaining({
        video: 3,
        post: 3,
        breakdown: expect.objectContaining({
          reels: 2,
          long_videos: 1,
          carousels: 3,
        }),
      })
    );
    expect(payload.weekly_capacity).toEqual(
      expect.objectContaining({
        video: 3,
        post: 3,
        breakdown: expect.objectContaining({
          reels: 2,
          long_videos: 1,
          carousels: 3,
        }),
      })
    );
  });
});
