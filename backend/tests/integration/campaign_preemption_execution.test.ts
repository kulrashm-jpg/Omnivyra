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
import { executeCampaignPreemption, PreemptionValidationError, type ExecutePreemptionResult } from '../../services/CampaignPreemptionService';
import { evaluatePortfolioConstraints } from '../../services/PortfolioConstraintEvaluator';

// Cross-tenant fix (6f, 2026-11-13): a preemption now REQUIRES companyId and both campaigns canonically owned by it.
// This suite tests preemption RULES, not tenancy (s2PreemptionCrossTenant pins that): it names a test company and
// answers ownership 'owned'.
const PREEMPT_TEST_COMPANY = '9e9e9e9e-0000-4000-8000-000000000001';
jest.mock('../../services/campaignOwnershipService', () => ({
  ...jest.requireActual('../../services/campaignOwnershipService'),
  checkCampaignOwnership: jest.fn(async () => 'owned'),
}));

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
        companyId: PREEMPT_TEST_COMPANY,
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        reason: 'Higher priority campaign requires capacity',
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      // The result is a union (executed | approval required): assert which, then narrow (was 5x TS2339).
      expect('success' in result).toBe(true);
      const executed = result as ExecutePreemptionResult;
      expect(executed.success).toBe(true);
      expect(executed.preemptedCampaignId).toBe(preemptedId);
      expect(executed.preemptedExecutionStatus).toBe('PREEMPTED');
      expect(executed.preemptedBlueprintStatus).toBe('INVALIDATED');
      expect(executed.logId).toBe(logId);

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
          companyId: PREEMPT_TEST_COMPANY,
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          justification: 'Revenue-critical board commitment for Q4 launch.',
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          companyId: PREEMPT_TEST_COMPANY,
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          justification: 'Revenue-critical board commitment for Q4 launch.',
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
          companyId: PREEMPT_TEST_COMPANY,
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          justification: 'Revenue-critical board commitment for Q4 launch.',
        })
      ).rejects.toThrow(PreemptionValidationError);

      await expect(
        executeCampaignPreemption({
          companyId: PREEMPT_TEST_COMPANY,
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          justification: 'Revenue-critical board commitment for Q4 launch.',
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
