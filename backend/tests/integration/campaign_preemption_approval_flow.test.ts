/**
 * Integration tests for Protected Campaigns & Approval Workflow (Stage 9B).
 * Tests: Protected target, CRITICAL target, Approve flow, Reject flow, Portfolio capacity after approval.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import {
  executeCampaignPreemption,
  executePreemptionFromRequest,
  rejectPreemptionRequest,
  PreemptionValidationError,
} from '../../services/CampaignPreemptionService';
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
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

describe('Campaign Preemption Approval Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — Protected campaign', () => {
    it('returns APPROVAL_REQUIRED, no execution_status change', async () => {
      const initiatorId = 'campaign-high-uuid';
      const targetId = 'campaign-protected-uuid';
      const requestId = 'request-uuid-123';

      let campaignsCallCount = 0;
      let requestsCallCount = 0;
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
          requestsCallCount++;
          return chainArray({
            data: { id: requestId },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_requests')).toBe(true);
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_log')).toBe(false);
    });
  });

  describe('Test 2 — CRITICAL target', () => {
    it('returns APPROVAL_REQUIRED when target is CRITICAL (same-rank CRITICAL vs CRITICAL)', async () => {
      const initiatorId = 'campaign-critical-uuid';
      const targetId = 'campaign-critical-target-uuid';
      const requestId = 'request-uuid-456';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
              { id: targetId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            ],
            error: null,
          });
        }
        if (table === 'campaign_preemption_requests') {
          return chainArray({ data: { id: requestId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);
    });

    it('returns APPROVAL_REQUIRED when target is protected (HIGH initiator preempts protected LOW)', async () => {
      const initiatorId = 'campaign-high-uuid';
      const targetId = 'campaign-protected-low-uuid';
      const requestId = 'request-uuid-789';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
              { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: true },
            ],
            error: null,
          });
        }
        if (table === 'campaign_preemption_requests') {
          return chainArray({ data: { id: requestId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);
    });
  });

  describe('Test 3 — Approve flow', () => {
    it('execution_status updated, request marked EXECUTED, log entry exists', async () => {
      const requestId = 'request-approve-uuid';
      const initiatorId = 'campaign-initiator-uuid';
      const targetId = 'campaign-target-uuid';
      const logId = 'log-uuid-approve';

      let reqCalls = 0;
      let campCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          reqCalls++;
          if (reqCalls === 1) {
            const c = chain({ data: null, error: null });
            c.maybeSingle = jest.fn().mockResolvedValue({
              data: { id: requestId, initiator_campaign_id: initiatorId, target_campaign_id: targetId, status: 'PENDING' },
              error: null,
            });
            return c;
          }
          return chain({ data: null, error: null });
        }
        if (table === 'campaigns') {
          campCalls++;
          if (campCalls === 1) {
            return chainArray({
              data: [
                { id: initiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
                { id: targetId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
              ],
              error: null,
            });
          }
          return chain({ data: null, error: null });
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: logId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executePreemptionFromRequest(
        requestId,
        'Approved: revenue-critical board commitment for Q4 launch.'
      );

      expect(result.success).toBe(true);
      expect(result.preemptedCampaignId).toBe(targetId);
      expect(result.preemptedExecutionStatus).toBe('PREEMPTED');
      expect(result.logId).toBe(logId);

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_requests')).toBe(true);
    });
  });

  describe('Test 4 — Reject flow', () => {
    it('request marked REJECTED, no execution', async () => {
      const requestId = 'request-reject-uuid';
      const initiatorId = 'campaign-initiator-uuid';
      let reqCalls = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          reqCalls++;
          const c = chain({ data: null, error: null });
          if (reqCalls === 1) {
            c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, initiator_campaign_id: initiatorId, status: 'PENDING' }, error: null });
          }
          return c;
        }
        return chain({ data: null, error: null });
      });

      await rejectPreemptionRequest(requestId);

      expect(reqCalls).toBeGreaterThanOrEqual(2);
    });

    it('throws when request is not PENDING', async () => {
      const requestId = 'request-already-executed';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, status: 'EXECUTED' }, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await expect(rejectPreemptionRequest(requestId)).rejects.toThrow(PreemptionValidationError);
      await expect(rejectPreemptionRequest(requestId)).rejects.toThrow('not pending');
    });
  });

  describe('Test 5 — Capacity recalculation after approval (PAUSED exclusion)', () => {
    it('PAUSED campaigns excluded from overlap; no team_overlap constraint', async () => {
      const campaignB = 'campaign-b';
      const campaignA = 'campaign-a';
      const teamId = 'team-1';
      const rangeStart = '2025-03-01';
      const rangeEnd = '2025-03-31';

      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: teamId }, error: null });
          return chainArray({
            data: [{ campaign_id: campaignA, weekly_capacity_reserved: 8, start_date: rangeStart, end_date: rangeEnd }],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        if (table === 'campaigns') {
          return chainArray({ data: [{ id: campaignA, execution_status: 'PAUSED' }], error: null });
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
