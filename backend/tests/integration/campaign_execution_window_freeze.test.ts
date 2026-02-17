/**
 * Stage 16 — Execution Window Freeze Guard Integration Tests.
 * Tests: 12h away → 409 EXECUTION_WINDOW_FROZEN, 48h away allowed, no posts allowed,
 * BLUEPRINT_FREEZE_BLOCKED event, ACTIVE still blocks first.
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
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../services/CampaignNegotiationService', () => ({
  runDurationNegotiation: jest.fn(),
}));

import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import negotiateDurationHandler from '../../../pages/api/campaigns/negotiate-duration';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { runDurationNegotiation } from '../../services/CampaignNegotiationService';
import { BLUEPRINT_FREEZE_WINDOW_HOURS } from '../../governance/GovernanceConfig';

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';

function chain(result: { data: any; error: any }) {
  const updateChain = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnValue(updateChain),
  };
  return q;
}

describe('Execution Window Freeze Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Scheduled post 12h away', () => {
    it('update-duration returns 409 EXECUTION_WINDOW_FROZEN', async () => {
      const in12h = new Date(Date.now() + 12 * 3600000).toISOString();
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 8,
        max_weeks_allowed: 8,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          const q = chain({
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
          return q;
        }
        if (table === 'scheduled_posts') {
          return chain({
            data: { scheduled_at: in12h },
            error: null,
          });
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
        code: 'EXECUTION_WINDOW_FROZEN',
        message: 'Blueprint modifications are locked within 24 hours of execution.',
      });
      const freezeCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_FREEZE_BLOCKED'
      );
      expect(freezeCalls.length).toBeGreaterThan(0);
      expect(freezeCalls[0][0].metadata).toMatchObject({
        campaignId: CAMPAIGN_ID,
        freezeWindowHours: BLUEPRINT_FREEZE_WINDOW_HOURS,
      });
      expect(freezeCalls[0][0].metadata.hoursUntilExecution).toBeLessThanOrEqual(24);
    });
  });

  describe('Scheduled post 48h away', () => {
    it('update-duration allowed', async () => {
      const in48h = new Date(Date.now() + 48 * 3600000).toISOString();
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 8,
        max_weeks_allowed: 8,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          const q = chain({
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
          return q;
        }
        if (table === 'scheduled_posts') {
          return chain({
            data: { scheduled_at: in48h },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: { campaignId: CAMPAIGN_ID, companyId: COMPANY_ID, requested_weeks: 8 },
      });
      const res = createMockRes();

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      const freezeCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_FREEZE_BLOCKED'
      );
      expect(freezeCalls.length).toBe(0);
    });
  });

  describe('No scheduled posts', () => {
    it('update-duration allowed', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 8,
        max_weeks_allowed: 8,
        limiting_constraints: [],
        blocking_constraints: [],
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          const q = chain({
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
          return q;
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

      expect(res.statusCode).toBe(200);
    });
  });

  describe('Governance event emitted', () => {
    it('BLUEPRINT_FREEZE_BLOCKED emitted when negotiate-duration blocked by freeze', async () => {
      const in12h = new Date(Date.now() + 12 * 3600000).toISOString();
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
          return chain({
            data: { scheduled_at: in12h },
            error: null,
          });
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
      const freezeCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_FREEZE_BLOCKED'
      );
      expect(freezeCalls.length).toBeGreaterThan(0);
      expect(freezeCalls[0][0].metadata).toMatchObject({
        campaignId: CAMPAIGN_ID,
        hoursUntilExecution: expect.any(Number),
        freezeWindowHours: BLUEPRINT_FREEZE_WINDOW_HOURS,
      });
    });
  });

  describe('ACTIVE lock takes precedence', () => {
    it('ACTIVE campaign still returns 409 BLUEPRINT_IMMUTABLE (not freeze)', async () => {
      const in12h = new Date(Date.now() + 12 * 3600000).toISOString();
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
          return chain({
            data: { scheduled_at: in12h },
            error: null,
          });
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
      expect(res.body.code).toBe('BLUEPRINT_IMMUTABLE');
      expect(res.body.code).not.toBe('EXECUTION_WINDOW_FROZEN');
      const freezeCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_FREEZE_BLOCKED'
      );
      expect(freezeCalls.length).toBe(0);
      const blockedCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'BLUEPRINT_MUTATION_BLOCKED'
      );
      expect(blockedCalls.length).toBeGreaterThan(0);
    });
  });
});
