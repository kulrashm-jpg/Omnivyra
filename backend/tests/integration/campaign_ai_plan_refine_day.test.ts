import handler from '../../../pages/api/campaigns/ai/plan';
import { assessVirality } from '../../services/viralityAdvisorService';
import { requestDecision } from '../../services/omnivyreClient';
import { saveAiCampaignPlan } from '../../db/campaignPlanStore';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn().mockResolvedValue({
    mode: 'refine_day',
    snapshot_hash: 'hash123',
    raw_plan_text: 'Refined day output',
    omnivyre_decision: {
      recommendation: 'HOLD',
      confidence: 0.7,
    },
    day: {
      week: 2,
      day: 'Tuesday',
      objective: 'Improve engagement',
      content: 'Updated post',
      platforms: { linkedin: 'Updated post' },
    },
  }),
  CampaignAiMode: {},
  normalizeCapacityCounts: jest.fn((value) => value),
  normalizeCapacityCountsWithBreakdown: jest.fn((value) => value),
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

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'campaign_versions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { company_id: 'comp123' }, error: null }),
        };
      }

      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  },
}));

jest.mock('../../services/rbacService', () => ({
  getUserCompanyRole: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'COMPANY_ADMIN' }),
  getCompanyRoleIncludingInvited: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/campaignRoleService', () => ({
  resolveEffectiveCampaignRole: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'COMPANY_ADMIN' }),
  isCompanyOverrideRole: jest.fn().mockReturnValue(true),
}));

jest.mock('../../db/campaignPlanStore', () => ({
  saveAiCampaignPlan: jest.fn(),
  saveDraftBlueprint: jest.fn(),
  getLatestDraftPlan: jest.fn().mockResolvedValue(null),
}));

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Refined day output' } }],
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

describe('Campaign AI Plan Refine Day', () => {
  it('persists and returns refined day', async () => {
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
        mode: 'refine_day',
        message: 'Refine Tuesday',
        targetDay: 'Tuesday',
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();

    await handler(req, res);

    expect(saveAiCampaignPlan).toHaveBeenCalledWith({
      campaignId: 'camp123',
      snapshot_hash: 'hash123',
      mode: 'refine_day',
      response: 'Refined day output',
      omnivyre_decision: expect.objectContaining({
        recommendation: 'HOLD',
      }),
    });

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.day).toEqual({
      week: 2,
      day: 'Tuesday',
      objective: 'Improve engagement',
      content: 'Updated post',
      platforms: { linkedin: 'Updated post' },
    });
  });
});
