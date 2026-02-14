/**
 * Integration tests for Controlled Preemption Execution.
 * Tests: Valid preemption, Invalid (same priority), Already preempted, Portfolio exclusion.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import { executeCampaignPreemption, PreemptionValidationError } from '../../services/CampaignPreemptionService';
import { evaluatePortfolioConstraints } from '../../services/PortfolioConstraintEvaluator';

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

describe('Campaign Preemption Execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — Valid Preemption (HIGH preempts LOW)', () => {
    it('marks preempted campaign as PREEMPTED, blueprint INVALIDATED, creates log entry', async () => {
      const initiatorId = 'campaign-high-uuid';
      const preemptedId = 'campaign-low-uuid';
      const logId = 'log-uuid-123';

      const campaignsData = [
        { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
        { id: preemptedId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
      ];
      let campaignsCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          return chainArray(
            campaignsCallCount <= 2 ? { data: campaignsData, error: null } : { data: null, error: null }
          );
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({
            data: { id: logId },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        reason: 'Higher priority campaign requires capacity',
      });

      expect(result.success).toBe(true);
      expect(result.preemptedCampaignId).toBe(preemptedId);
      expect(result.preemptedExecutionStatus).toBe('PREEMPTED');
      expect(result.preemptedBlueprintStatus).toBe('INVALIDATED');
      expect(result.logId).toBe(logId);

      expect(supabase.from).toHaveBeenCalledWith('campaigns');
      const updateCall = (supabase.from as jest.Mock).mock.results.find(
        (r: any) => r.value?.update !== undefined
      );
      expect(updateCall).toBeDefined();
      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_log')).toBe(true);
    });
  });

  describe('Test 2 — Invalid Preemption (Same Priority)', () => {
    it('throws PreemptionValidationError, no status change', async () => {
      const initiatorId = 'campaign-a-uuid';
      const preemptedId = 'campaign-b-uuid';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
              { id: preemptedId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
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
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
        })
      ).rejects.toThrow(PreemptionValidationError);

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      const logCalls = fromCalls.filter((c: string[]) => c[0] === 'campaign_preemption_log');
      expect(logCalls.length).toBe(0);
    });
  });

  describe('Test 3 — Already Preempted', () => {
    it('rejects execution with PreemptionValidationError', async () => {
      const initiatorId = 'campaign-high-uuid';
      const preemptedId = 'campaign-low-uuid';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
              { id: preemptedId, priority_level: 'LOW', execution_status: 'PREEMPTED', blueprint_status: 'INVALIDATED' },
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
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
        })
      ).rejects.toThrow('already preempted');
    });
  });

  describe('Test 4 — Portfolio Exclusion', () => {
    it('PREEMPTED campaigns excluded from overlap; capacity recalculates correctly', async () => {
      const campaignB = 'campaign-b';
      const campaignA = 'campaign-a';
      const teamId = 'team-1';
      const rangeStart = '2025-03-01';
      const rangeEnd = '2025-03-31';

      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) {
            return chain({ data: { team_id: teamId }, error: null });
          }
          return chainArray({
            data: [
              {
                campaign_id: campaignA,
                weekly_capacity_reserved: 8,
                start_date: rangeStart,
                end_date: rangeEnd,
              },
            ],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        if (table === 'campaigns') {
          return chainArray({
            data: [{ id: campaignA, execution_status: 'PREEMPTED' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const output = await evaluatePortfolioConstraints({
        campaignId: campaignB,
        companyId: 'company-1',
        requestedDurationWeeks: 4,
        requestedPostsPerWeek: 5,
        startDate: rangeStart,
        endDate: rangeEnd,
        existing_content_count: 20,
      });

      const overlapConstraint = output.constraints.find((r) => r.name === 'team_overlap');
      expect(overlapConstraint).toBeUndefined();
    });
  });
});
