/**
 * Stage 15 — Blueprint Execution Integrity Guard Integration Tests.
 * Tests: ACTIVE → 409, PAUSED allowed, INVALIDATED allowed, BLUEPRINT_MUTATION_BLOCKED event.
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
jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: jest.fn().mockResolvedValue({
    plan: { weeks: [{ week_number: 1, theme: 'Week 1', platforms: [] }] },
  }),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: jest.fn((x: any) => ({ ...x, duration_weeks: 12 })),
}));

import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import regenerateBlueprintHandler from '../../../pages/api/campaigns/regenerate-blueprint';
import negotiateDurationHandler from '../../../pages/api/campaigns/negotiate-duration';
import runPreplanningHandler from '../../../pages/api/campaigns/run-preplanning';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { runDurationNegotiation } from '../../services/CampaignNegotiationService';

jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../services/CampaignNegotiationService', () => ({
  runDurationNegotiation: jest.fn(),
}));

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const updateChain = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnValue(updateChain),
  };
  return q;
}

describe('Blueprint Execution Integrity Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
  });

  describe('ACTIVE campaign', () => {
    it('update-duration returns 409 when execution_status is ACTIVE', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              duration_locked: false,
              duration_weeks: 12,
              blueprint_status: 'ACTIVE',
              execution_status: 'ACTIVE',
            },
            error: null,
          });
        }
        if (table === 'scheduled_posts') {
          return chain({ data: null, error: null });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'BLUEPRINT_IMMUTABLE',
        message: 'Blueprint cannot be modified while campaign is in execution.',
      });
      const blockedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_MUTATION_BLOCKED'
      );
      expect(blockedCalls.length).toBeGreaterThan(0);
      expect(blockedCalls[0][0].metadata).toMatchObject({
        campaignId: CAMPAIGN_ID,
        execution_status: 'ACTIVE',
        blueprint_status: 'ACTIVE',
      });
    });

    it('regenerate-blueprint returns 409 when execution_status is ACTIVE', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              blueprint_status: 'ACTIVE',
              duration_weeks: 12,
              execution_status: 'ACTIVE',
            },
            error: null,
          });
        }
        if (table === 'scheduled_posts') {
          return chain({ data: null, error: null });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID },
      });
      const res = createMockRes();

      await regenerateBlueprintHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'BLUEPRINT_IMMUTABLE',
        message: 'Blueprint cannot be modified while campaign is in execution.',
      });
    });
  });

  describe('PAUSED campaign', () => {
    it('update-duration allowed when execution_status is PAUSED', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 8,
        max_weeks_allowed: 8,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.select = jest.fn().mockReturnThis();
          q.eq = jest.fn().mockReturnThis();
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: CAMPAIGN_ID,
              duration_locked: false,
              duration_weeks: 12,
              blueprint_status: 'ACTIVE',
              execution_status: 'PAUSED',
            },
            error: null,
          });
          q.update = jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: null, error: null }),
          });
        }
        if (table === 'scheduled_posts') {
          q.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
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
      const blockedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_MUTATION_BLOCKED'
      );
      expect(blockedCalls.length).toBe(0);
    });
  });

  describe('INVALIDATED blueprint', () => {
    it('regenerate-blueprint allowed when blueprint_status is INVALIDATED and no scheduled posts', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.select = jest.fn().mockReturnThis();
          q.eq = jest.fn().mockReturnThis();
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: CAMPAIGN_ID,
              blueprint_status: 'INVALIDATED',
              duration_weeks: 12,
              execution_status: 'ACTIVE',
            },
            error: null,
          });
          q.update = jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: null, error: null }),
          });
        }
        if (table === 'scheduled_posts') {
          q.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
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
    });
  });

  describe('Governance event emitted', () => {
    it('BLUEPRINT_MUTATION_BLOCKED emitted when negotiate-duration is blocked', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              duration_weeks: 12,
              execution_status: 'ACTIVE',
              blueprint_status: 'ACTIVE',
            },
            error: null,
          });
        }
        if (table === 'scheduled_posts') {
          return chain({ data: { id: 'p1' }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, message: 'extend' },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(409);
      const blockedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_MUTATION_BLOCKED'
      );
      expect(blockedCalls.length).toBeGreaterThan(0);
    });
  });

  describe('No regression when mutable', () => {
    it('negotiate-duration succeeds when mutable (PAUSED)', async () => {
      (runDurationNegotiation as jest.Mock).mockResolvedValue({
        evaluation: { status: 'APPROVED', requested_weeks: 14, max_weeks_allowed: 14 },
        explanation: 'Approved.',
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({
            data: {
              id: CAMPAIGN_ID,
              duration_weeks: 12,
              execution_status: 'PAUSED',
              blueprint_status: 'ACTIVE',
            },
            error: null,
          });
        }
        if (table === 'scheduled_posts') {
          return chain({ data: null, error: null });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, message: '14 weeks' },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });
  });
});
