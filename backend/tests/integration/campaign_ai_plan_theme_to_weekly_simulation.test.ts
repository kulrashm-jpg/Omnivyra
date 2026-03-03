/**
 * Simulation: theme card + user answers → weekly plan stage.
 * Verifies that when we send recommendationContext (strategic theme) + conversationHistory
 * ending in "Yes, proceed with 4 weeks", the plan API returns a plan with weeks (reaches weekly plan stage).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-sim-1' }, error: null }),
}));

jest.mock('../../services/rbacService', () => ({
  getUserCompanyRole: jest.fn().mockResolvedValue({ role: 'COMPANY_ADMIN', userId: 'user-sim-1' }),
  getCompanyRoleIncludingInvited: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/campaignRoleService', () => ({
  resolveEffectiveCampaignRole: jest.fn().mockResolvedValue({ role: 'CAMPAIGN_MANAGER', error: null }),
  isCompanyOverrideRole: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/campaignPlanningInputsService', () => ({
  getCampaignPlanningInputs: jest.fn().mockResolvedValue(null),
  saveCampaignPlanningInputs: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../db/campaignPlanStore', () => ({
  saveAiCampaignPlan: jest.fn().mockResolvedValue(undefined),
  saveDraftBlueprint: jest.fn().mockResolvedValue(undefined),
  getLatestDraftPlan: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: jest.fn((x: any) => ({ ...x, duration_weeks: x?.weeks?.length ?? 4 })),
}));

jest.mock('../../services/schedulingService', () => ({
  detectCampaignConflicts: jest.fn().mockResolvedValue([]),
  suggestAvailableDateRange: jest.fn().mockResolvedValue(null),
}));

const mockRunCampaignAiPlan = jest.fn();
jest.mock('../../services/campaignAiOrchestrator', () => {
  const actual = jest.requireActual('../../services/campaignAiOrchestrator');
  return {
    ...actual,
    runCampaignAiPlan: (...args: any[]) => mockRunCampaignAiPlan(...args),
  };
});

jest.mock('../../chatGovernance', () => ({
  validateAndModerateUserMessage: jest.fn().mockResolvedValue({ allowed: true, reason: null, code: null }),
}));

import { supabase } from '../../db/supabaseClient';

const COMPANY_ID = 'company-sim-1';
const CAMPAIGN_ID = 'campaign-sim-theme-1';

function chain(result: { data: any; error: any }) {
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  return q;
}

function setupSupabase() {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaign_versions') {
      return chain({ data: { company_id: COMPANY_ID }, error: null });
    }
    if (table === 'campaigns') {
      return chain({
        data: {
          id: CAMPAIGN_ID,
          user_id: 'user-sim-1',
          duration_weeks: 4,
          start_date: '2026-04-01',
          description: 'Campaign from themes',
          name: 'Theme campaign',
        },
        error: null,
      });
    }
    return chain({ data: null, error: null });
  });
}

function createMockRes() {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
}

describe('Campaign AI Plan — theme to weekly plan simulation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupSupabase();
    mockRunCampaignAiPlan.mockImplementation((input: any) => {
      // Simulate orchestrator returning a 4-week plan when we have theme + confirmation
      const hasConfirmation =
        input?.conversationHistory?.length > 0 &&
        /proceed with|yes\s*,?\s*proceed|^\s*yes\s*$/i.test(
          input.conversationHistory.filter((m: any) => m?.type === 'user').pop()?.message ?? ''
        );
      const hasTheme =
        input?.recommendationContext?.context_payload &&
        (Array.isArray((input.recommendationContext.context_payload as any).strategic_themes) ||
          (input.recommendationContext.context_payload as any).progression_summary);
      if (hasConfirmation && (hasTheme || input?.collectedPlanningContext?.target_audience)) {
        return Promise.resolve({
          mode: 'generate_plan',
          snapshot_hash: 'sim-hash',
          omnivyre_decision: { status: 'ok', recommendation: 'proceed' as const },
          plan: {
            weeks: Array.from({ length: 4 }, (_, i) => ({
              week: i + 1,
              theme: `Week ${i + 1} theme`,
              phase_label: i === 0 ? 'Launch' : 'Activation',
              daily: [],
            })),
          },
          raw_plan_text: 'BEGIN_12WEEK_PLAN\n...\nEND_12WEEK_PLAN',
        });
      }
      return Promise.resolve({
        mode: 'generate_plan',
        snapshot_hash: 'sim-hash',
        omnivyre_decision: { status: 'ok', recommendation: 'proceed' as const },
        conversationalResponse: 'Who is your primary target audience?',
        raw_plan_text: '',
      });
    });
  });

  it('reaches weekly plan stage when theme + confirmation are sent (simulated orchestrator)', async () => {
    const handler = (await import('../../../pages/api/campaigns/ai/plan')).default;
    const req = {
      method: 'POST',
      body: {
        campaignId: CAMPAIGN_ID,
        companyId: COMPANY_ID,
        mode: 'generate_plan',
        message: 'Yes, proceed with 4 weeks.',
        durationWeeks: 4,
        messages: [
          { type: 'ai', message: 'Anything only for one platform? (e.g., LinkedIn, Instagram)' },
          { type: 'user', message: 'No.' },
          { type: 'ai', message: "What's the one thing you want people to remember?" },
          { type: 'user', message: 'aligned to the theme' },
          { type: 'ai', message: 'I have everything I need. Would you like me to create your week plan now?' },
          { type: 'user', message: 'Yes, proceed with 4 weeks.' },
        ],
        recommendationContext: {
          target_regions: ['US'],
          context_payload: {
            polished_title: 'Campaign from themes',
            topic: 'Strategic theme',
            strategic_themes: ['Theme A', 'Theme B', 'Theme C'],
            progression_summary: 'Awareness → Consideration → Decision',
            duration_weeks: 4,
          },
        },
        collectedPlanningContext: {
          target_audience: 'Marketing leads',
          platforms: 'linkedin, instagram',
        },
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.plan).toBeDefined();
    expect(payload.plan.weeks).toBeDefined();
    expect(payload.plan.weeks.length).toBe(4);
    expect(payload.mode).toBe('generate_plan');

    expect(mockRunCampaignAiPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        mode: 'generate_plan',
        message: 'Yes, proceed with 4 weeks.',
        durationWeeks: 4,
        conversationHistory: expect.any(Array),
        recommendationContext: expect.objectContaining({
          context_payload: expect.objectContaining({
            strategic_themes: ['Theme A', 'Theme B', 'Theme C'],
            progression_summary: 'Awareness → Consideration → Decision',
            duration_weeks: 4,
          }),
        }),
      })
    );
  });

  it('passes merged collectedPlanningContext (theme + Q&A answers) to orchestrator', async () => {
    const handler = (await import('../../../pages/api/campaigns/ai/plan')).default;
    const req = {
      method: 'POST',
      body: {
        campaignId: CAMPAIGN_ID,
        companyId: COMPANY_ID,
        mode: 'generate_plan',
        message: 'Yes, proceed with 4 weeks.',
        durationWeeks: 4,
        messages: [
          { type: 'ai', message: 'Who is your primary target audience?' },
          { type: 'user', message: 'Marketing leads' },
          { type: 'ai', message: 'Would you like me to create your week plan now?' },
          { type: 'user', message: 'Yes, proceed with 4 weeks.' },
        ],
        recommendationContext: {
          context_payload: {
            strategic_themes: ['Theme 1'],
            progression_summary: 'Progression',
            duration_weeks: 4,
          },
        },
      },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await handler(req, res);

    expect(mockRunCampaignAiPlan).toHaveBeenCalled();
    const callArg = mockRunCampaignAiPlan.mock.calls[0][0];
    expect(callArg.collectedPlanningContext).toBeDefined();
    expect(callArg.collectedPlanningContext?.target_audience).toBe('Marketing leads');
    expect(callArg.recommendationContext?.context_payload?.strategic_themes).toEqual(['Theme 1']);
  });
});
