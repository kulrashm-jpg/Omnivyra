/**
 * Stage 12 — AI Negotiation Loop Integration Tests.
 * Tests: approved, negotiated, rejected, PRE_PLANNING_REQUIRED, DURATION_NEGOTIATED event.
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

import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import negotiateDurationHandler from '../../../pages/api/campaigns/negotiate-duration';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { supabase } from '../../db/supabaseClient';

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

describe('Campaign Negotiation Loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
  });

  describe('1. Approved negotiation', () => {
    it('returns APPROVED status with evaluation and explanation', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'APPROVED',
        requested_weeks: 14,
        max_weeks_allowed: 14,
        limiting_constraints: [],
        blocking_constraints: [],
        tradeOffOptions: undefined,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: CAMPAIGN_ID, duration_weeks: 12, execution_status: 'PAUSED' },
            error: null,
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: CAMPAIGN_ID,
          companyId: COMPANY_ID,
          message: 'Can we stretch this to 14 weeks?',
        },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.evaluation).toBeDefined();
      expect(res.body.explanation).toBeTruthy();
      expect(res.body.trade_off_options).toEqual([]);
    });
  });

  describe('2. Negotiated result', () => {
    it('returns NEGOTIATE status with trade_off_options', async () => {
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

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: CAMPAIGN_ID, duration_weeks: 12, execution_status: 'PAUSED' },
            error: null,
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: CAMPAIGN_ID,
          companyId: COMPANY_ID,
          message: 'extend',
        },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('NEGOTIATE');
      expect(res.body.trade_off_options).toHaveLength(1);
      expect(res.body.trade_off_options[0].type).toBe('EXTEND_DURATION');
      expect(res.body.trade_off_options[0].newDurationWeeks).toBe(6);
    });
  });

  describe('3. Rejected result', () => {
    it('returns REJECTED status', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'REJECTED',
        requested_weeks: 12,
        max_weeks_allowed: 0,
        limiting_constraints: [],
        blocking_constraints: [{ name: 'inventory', reasoning: 'No content' }],
        tradeOffOptions: undefined,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: CAMPAIGN_ID, duration_weeks: 8, execution_status: 'PAUSED' },
            error: null,
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: CAMPAIGN_ID,
          companyId: COMPANY_ID,
          message: 'reduce',
        },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.explanation).toBeTruthy();
    });
  });

  describe('4. PRE_PLANNING_REQUIRED when duration null', () => {
    it('returns 412 when duration_weeks is null', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: CAMPAIGN_ID, duration_weeks: null, execution_status: 'PAUSED' },
            error: null,
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: CAMPAIGN_ID,
          companyId: COMPANY_ID,
          message: '14 weeks',
        },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(res.statusCode).toBe(412);
      expect(res.body.code).toBe('PRE_PLANNING_REQUIRED');
      expect(res.body.message).toContain('pre-planning');
      expect(runPrePlanning).not.toHaveBeenCalled();
    });
  });

  describe('5. DURATION_NEGOTIATED event recorded', () => {
    it('recordGovernanceEvent called with DURATION_NEGOTIATED and metadata', async () => {
      (runPrePlanning as jest.Mock).mockResolvedValue({
        status: 'NEGOTIATE',
        requested_weeks: 14,
        max_weeks_allowed: 6,
        limiting_constraints: [],
        blocking_constraints: [],
        tradeOffOptions: [],
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const q = chain({ data: null, error: null });
        if (table === 'campaigns') {
          q.maybeSingle = jest.fn().mockResolvedValue({
            data: { id: CAMPAIGN_ID, duration_weeks: 12, execution_status: 'PAUSED' },
            error: null,
          });
        }
        return q;
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: CAMPAIGN_ID,
          companyId: COMPANY_ID,
          message: 'Can we stretch this to 14 weeks?',
        },
      });
      const res = createMockRes();

      await negotiateDurationHandler(req, res);

      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'DURATION_NEGOTIATED',
          eventStatus: 'NEGOTIATE',
          metadata: expect.objectContaining({
            requested_weeks: 14,
            max_weeks_allowed: 6,
            negotiation_message: expect.any(String),
          }),
        })
      );
    });
  });
});
