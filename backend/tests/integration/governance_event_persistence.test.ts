/**
 * Governance Event Persistence — Integration Tests.
 * Verifies events are recorded for: DURATION_NEGOTIATE, DURATION_REJECTED,
 * PREEMPTION_EXECUTED, PREEMPTION_REJECTED, SHIFT_START_DATE_SUGGESTED, PREEMPTION_APPROVAL_REQUIRED.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(new Date('2026-04-01')),
}));

import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { executeCampaignPreemption, PreemptionValidationError } from '../../services/CampaignPreemptionService';
import { evaluatePortfolioConstraints } from '../../services/PortfolioConstraintEvaluator';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function chainArray(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const VALID_JUSTIFICATION = 'Revenue-critical board commitment for Q4 launch.';
const COMPANY_ID = 'company-uuid-123';
const CAMPAIGN_ID = 'campaign-uuid-456';

describe('Governance Event Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
  });

  describe('1. Duration NEGOTIATE → event recorded', () => {
    it('records DURATION_NEGOTIATE when status is NEGOTIATE', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 20,
        existing_content_count: 30,
        expected_posts_per_week: 5,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'DURATION_NEGOTIATE',
          eventStatus: expect.stringMatching(/NEGOTIATE|REJECTED/),
          metadata: expect.objectContaining({
            requested_weeks: 20,
            max_weeks_allowed: 6,
            limiting_constraints_count: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('2. Duration REJECTED → event recorded', () => {
    it('records DURATION_REJECTED when status is REJECTED', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 0,
        expected_posts_per_week: 5,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
      });

      expect(result.status).toBe('REJECTED');
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'DURATION_REJECTED',
          eventStatus: 'REJECTED',
          metadata: expect.objectContaining({
            requested_weeks: 12,
            max_weeks_allowed: 0,
            blocking_constraints_count: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('3. Preemption EXECUTED → event recorded', () => {
    it('records PREEMPTION_EXECUTED when preemption succeeds', async () => {
      const initiatorId = 'campaign-high-uuid';
      const preemptedId = 'campaign-low-uuid';
      const logId = 'log-uuid-123';
      let campaignsCallCount = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray(
            campaignsCallCount <= 2
              ? {
                  data: [
                    { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                    { id: preemptedId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                  ],
                  error: null,
                }
              : { data: null, error: null }
          );
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: logId, justification: VALID_JUSTIFICATION }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: VALID_JUSTIFICATION,
        companyId: COMPANY_ID,
      });

      expect('success' in result && result.success).toBe(true);
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: initiatorId,
          eventType: 'PREEMPTION_EXECUTED',
          eventStatus: 'EXECUTED',
          metadata: expect.objectContaining({
            targetCampaignId: preemptedId,
            initiatorPriority: 'HIGH',
            targetPriority: 'LOW',
            justification: VALID_JUSTIFICATION,
          }),
        })
      );
    });
  });

  describe('4. Preemption REJECTED → event recorded', () => {
    it('records PREEMPTION_REJECTED when equal priority', async () => {
      const initiatorId = 'campaign-a-uuid';
      const preemptedId = 'campaign-b-uuid';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
              { id: preemptedId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          justification: VALID_JUSTIFICATION,
          companyId: COMPANY_ID,
        })
      ).rejects.toThrow(PreemptionValidationError);

      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: initiatorId,
          eventType: 'PREEMPTION_REJECTED',
          eventStatus: 'REJECTED',
          metadata: expect.objectContaining({
            reason: expect.any(String),
            targetCampaignId: preemptedId,
          }),
        })
      );
    });
  });

  describe('5. SHIFT_START_DATE → event recorded', () => {
    it('records SHIFT_START_DATE_SUGGESTED when portfolio suggests shift', async () => {
      const teamId = 'team-1';
      const rangeStart = '2026-03-01';
      const rangeEnd = '2026-03-31';
      let fromCalls = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: teamId }, error: null });
          return chainArray({
            data: [
              { campaign_id: 'campaign-a', weekly_capacity_reserved: 10, start_date: rangeStart, end_date: '2026-03-30' },
            ],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const output = await evaluatePortfolioConstraints({
        campaignId: CAMPAIGN_ID,
        companyId: COMPANY_ID,
        requestedDurationWeeks: 4,
        requestedPostsPerWeek: 5,
        startDate: rangeStart,
        endDate: rangeEnd,
      });

      expect(output.suggestedTradeOffs).toBeDefined();
      const shift = output.suggestedTradeOffs?.find((o) => o.type === 'SHIFT_START_DATE');
      expect(shift).toBeDefined();
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          eventType: 'SHIFT_START_DATE_SUGGESTED',
          eventStatus: 'SUGGESTED',
          metadata: expect.objectContaining({
            newStartDate: expect.any(String),
            requestedPostsPerWeek: 5,
          }),
        })
      );
    });
  });

  describe('6. Approval required → event recorded', () => {
    it('records PREEMPTION_APPROVAL_REQUIRED when target is protected', async () => {
      const initiatorId = 'campaign-high-uuid';
      const targetId = 'campaign-protected-uuid';
      const requestId = 'request-uuid-123';
      let campaignsCallCount = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          if (campaignsCallCount === 1) {
            return chainArray({
              data: [
                { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
                { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: true },
              ],
              error: null,
            });
          }
        }
        if (table === 'campaign_preemption_requests') {
          return chainArray({ data: { id: requestId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: VALID_JUSTIFICATION,
        companyId: COMPANY_ID,
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(recordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: initiatorId,
          eventType: 'PREEMPTION_APPROVAL_REQUIRED',
          eventStatus: 'PENDING',
          metadata: expect.objectContaining({
            targetCampaignId: targetId,
          }),
        })
      );
    });
  });
});
