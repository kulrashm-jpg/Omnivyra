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
    expect(payload.response).toBe('Test campaign plan output');
    expect(payload.omnivyre_decision.recommendation).toBe('HOLD');
  });
});
