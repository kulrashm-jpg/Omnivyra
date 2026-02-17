/**
 * Governance Contract — Trade-Off Ordering Test.
 * Verifies TRADE_OFF_PRIORITY_ORDER: NORMAL vs HIGH/CRITICAL.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(new Date('2026-04-01')),
}));

import { supabase } from '../../db/supabaseClient';
import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { TRADE_OFF_PRIORITY_ORDER } from '../../governance/GovernanceContract';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
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
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

describe('Governance Contract — Trade-Off Ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('NORMAL priority', () => {
    it('first tradeOffOptions[0].type is SHIFT_START_DATE when present', async () => {
      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: 'team-1' }, error: null });
          return chainArray({
            data: [
              { campaign_id: 'campaign-a', weekly_capacity_reserved: 10, start_date: '2026-03-01', end_date: '2026-03-30' },
            ],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        campaignId: 'campaign-b',
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 5,
        campaignPriorityLevel: 'NORMAL',
      });

      expect(result.tradeOffOptions).toBeDefined();
      expect(result.tradeOffOptions!.length).toBeGreaterThan(0);
      const shiftIndex = result.tradeOffOptions!.findIndex((o) => o.type === 'SHIFT_START_DATE');
      if (shiftIndex >= 0) {
        expect(result.tradeOffOptions![0].type).toBe('SHIFT_START_DATE');
      }
    });

    it('ordering matches TRADE_OFF_PRIORITY_ORDER.NORMAL', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 8,
        existing_content_count: 100,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 1000,
        cost_per_week: 500,
        campaignPriorityLevel: 'NORMAL',
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      const types = result.tradeOffOptions!.map((o) => o.type);
      const order = TRADE_OFF_PRIORITY_ORDER.NORMAL;
      for (let i = 0; i < types.length - 1; i++) {
        const rankA = order.indexOf(types[i] as any);
        const rankB = order.indexOf(types[i + 1] as any);
        expect(rankA).toBeLessThanOrEqual(rankB);
      }
    });
  });

  describe('HIGH priority', () => {
    it('first tradeOffOptions[0].type is PREEMPT_LOWER_PRIORITY_CAMPAIGN when present', async () => {
      const campaignA = 'campaign-a-uuid';
      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: 'team-1' }, error: null });
          return chainArray({
            data: [
              { campaign_id: campaignA, weekly_capacity_reserved: 8, start_date: '2026-03-01', end_date: '2026-03-15' },
            ],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        if (table === 'campaigns') {
          return chainArray({
            data: [{ id: campaignA, priority_level: 'LOW' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        campaignId: 'campaign-b',
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'HIGH',
      });

      expect(result.tradeOffOptions).toBeDefined();
      const preempt = result.tradeOffOptions!.find((o) => o.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      if (preempt) {
        expect(result.tradeOffOptions![0].type).toBe('PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      }
    });

    it('ordering matches TRADE_OFF_PRIORITY_ORDER.HIGH_OR_CRITICAL', async () => {
      const campaignA = 'campaign-a-uuid';
      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: 'team-1' }, error: null });
          return chainArray({
            data: [
              { campaign_id: campaignA, weekly_capacity_reserved: 8, start_date: '2026-03-01', end_date: '2026-03-15' },
            ],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        if (table === 'campaigns') {
          return chainArray({
            data: [{ id: campaignA, priority_level: 'LOW' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        campaignId: 'campaign-b',
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'HIGH',
      });

      expect(result.tradeOffOptions).toBeDefined();
      const types = result.tradeOffOptions!.map((o) => o.type);
      const order = TRADE_OFF_PRIORITY_ORDER.HIGH_OR_CRITICAL;
      for (let i = 0; i < types.length - 1; i++) {
        const rankA = order.indexOf(types[i] as any);
        const rankB = order.indexOf(types[i + 1] as any);
        expect(rankA).toBeLessThanOrEqual(rankB);
      }
    });
  });
});
