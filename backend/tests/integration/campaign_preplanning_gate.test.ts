/**
 * Stage 11 — Campaign Pre-Planning Gate Integration Tests.
 * Tests: PRE_PLANNING_REQUIRED guard, run-preplanning API, governance event, full flow.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1' }),
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/aiGateway', () => ({
  generatePrePlanningExplanation: jest.fn().mockResolvedValue('AI explanation summary.'),
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../services/campaignBlueprintService', () => {
  const actual = jest.requireActual('../../services/campaignBlueprintService');
  return {
    ...actual,
    getResolvedCampaignPlanContext: jest.fn(),
  };
});
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn().mockResolvedValue({ company_id: 'company-123', category: 'marketing' }),
}));
jest.mock('../../db/platformExecutionStore', () => ({
  getLatestPlatformExecutionPlan: jest.fn().mockResolvedValue(null),
  savePlatformExecutionPlan: jest.fn().mockResolvedValue(undefined),
  saveSchedulerJobs: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  enforceRole: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'ADMIN' }),
}));
jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn().mockResolvedValue({
    plan: {
      weeks: Array.from({ length: 8 }, (_, i) => ({
        week_number: i + 1,
        theme: `Week ${i + 1}`,
        platforms: [],
      })),
    },
  }),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: jest.fn().mockResolvedValue(undefined),
}));

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';

import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import schedulerPayloadHandler from '../../../pages/api/campaigns/scheduler-payload';
import runPreplanningHandler from '../../../pages/api/campaigns/run-preplanning';
import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import regenerateBlueprintHandler from '../../../pages/api/campaigns/regenerate-blueprint';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';
import { PrePlanningRequiredError, getResolvedCampaignPlanContext } from '../../services/campaignBlueprintService';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
  };
}

describe('Campaign Pre-Planning Gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chain({
          data: { id: CAMPAIGN_ID, execution_status: 'DRAFT' },
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });
  });

  describe('1. duration null → scheduler endpoint returns PRE_PLANNING_REQUIRED', () => {
    it('scheduler-payload returns 412 when getResolvedCampaignPlanContext throws PrePlanningRequiredError', async () => {
      (getResolvedCampaignPlanContext as jest.Mock).mockRejectedValue(
        new PrePlanningRequiredError('Campaign duration not initialized. Run pre-planning first.')
      );

      const req = createApiRequestMock({
        method: 'POST',
        body: { companyId: COMPANY_ID, campaignId: CAMPAIGN_ID, weekNumber: 1 },
      });
      const res = createMockRes();

      await schedulerPayloadHandler(req, res);

      expect(res.statusCode).toBe(412);
      expect(res.body).toEqual({
        code: 'PRE_PLANNING_REQUIRED',
        message: 'Campaign duration not initialized. Run pre-planning first.',
      });
    });
  });

  describe('2. getResolvedCampaignPlanContext throws when duration_weeks is null', () => {
    it('service throws PrePlanningRequiredError when campaign has duration_weeks null', async () => {
      const { getResolvedCampaignPlanContext: realGet } = jest.requireActual(
        '../../services/campaignBlueprintService'
      );

      let campaignsCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockImplementation(() => {
            campaignsCallCount++;
            if (campaignsCallCount === 1) {
              return Promise.resolve({ data: { duration_weeks: null }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          });
        }
        return q;
      });

      await expect(realGet(COMPANY_ID, CAMPAIGN_ID, false)).rejects.toThrow(PrePlanningRequiredError);

      const err = await realGet(COMPANY_ID, CAMPAIGN_ID, false).catch((e: Error) => e);
      expect(err).toBeInstanceOf(PrePlanningRequiredError);
      expect((err as { code?: string }).code).toBe('PRE_PLANNING_REQUIRED');
    });
  });

  describe('3. run-preplanning returns deterministic structured result', () => {
    it('returns status, requested_weeks, recommended_duration, constraints, trade_off_options, explanation_summary', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 12,
        max_weeks_allowed: 12,
        min_weeks_required: undefined,
        limiting_constraints: [],
        blocking_constraints: [],
        tradeOffOptions: undefined,
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 12 },
      });
      const res = createMockRes();

      await runPreplanningHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        requested_weeks: 12,
        recommended_duration: 12,
        limiting_constraints: [],
        blocking_constraints: [],
        explanation_summary: 'AI explanation summary.',
      });
      expect(res.body).toHaveProperty('max_weeks_allowed');
      expect(res.body).toHaveProperty('trade_off_options');
    });

    it('run-preplanning with NEGOTIATE returns trade_off_options', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'NEGOTIATE',
        requested_weeks: 20,
        max_weeks_allowed: 6,
        min_weeks_required: 4,
        limiting_constraints: [{ name: 'inventory', reasoning: 'Limited content' }],
        blocking_constraints: [],
        tradeOffOptions: [
          {
            type: 'EXTEND_DURATION',
            newDurationWeeks: 6,
            reasoning: 'Reduce duration to fit inventory.',
          },
        ],
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 20 },
      });
      const res = createMockRes();

      await runPreplanningHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('NEGOTIATE');
      expect(res.body.recommended_duration).toBe(4);
      expect(res.body.trade_off_options).toHaveLength(1);
      expect(res.body.trade_off_options[0].type).toBe('EXTEND_DURATION');
      expect(res.body.trade_off_options[0].newDurationWeeks).toBe(6);
    });
  });

  describe('4. PRE_PLANNING_EVALUATED event persisted', () => {
    it('recordGovernanceEvent called with PRE_PLANNING_EVALUATED and metadata', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 12,
        max_weeks_allowed: 12,
        min_weeks_required: undefined,
        limiting_constraints: [],
        blocking_constraints: [],
        tradeOffOptions: undefined,
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 12 },
      });
      const res = createMockRes();

      await runPreplanningHandler(req, res);

      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'PRE_PLANNING_EVALUATED',
          eventStatus: 'APPROVED',
          metadata: expect.objectContaining({
            requested_weeks: 12,
            max_weeks_allowed: 12,
            constraint_counts: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('5. Full flow: update-duration then regenerate-blueprint', () => {
    it('update-duration sets duration and INVALIDATED', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 8,
        max_weeks_allowed: 12,
        limiting_constraints: [],
        blocking_constraints: [],
        tradeOffOptions: undefined,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.select = jest.fn().mockReturnThis();
          q.eq = jest.fn().mockReturnThis();
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: CAMPAIGN_ID,
              duration_weeks: null,
              blueprint_status: null,
              duration_locked: false,
              execution_status: 'PAUSED',
            },
            error: null,
          });
          q.update = jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.status).toBe('REGENERATION_REQUIRED');
      expect(res.body?.duration_weeks).toBe(8);
    });

    it('regenerate-blueprint succeeds after update-duration when blueprint_status is INVALIDATED', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.select = jest.fn().mockReturnThis();
          q.eq = jest.fn().mockReturnThis();
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: CAMPAIGN_ID,
              duration_weeks: 8,
              blueprint_status: 'INVALIDATED',
            },
            error: null,
          });
          q.update = jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID },
      });
      const res = createMockRes();

      await regenerateBlueprintHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(res.body?.blueprint_status).toBe('ACTIVE');
    });
  });
});
