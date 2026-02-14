/**
 * Integration tests for Campaign Priority and Preemption (Stage 8).
 * Tests: HIGH preempts LOW, same priority no preemption, CRITICAL ranking, LOW priority no preemption.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(new Date('2026-04-01')),
}));

import { supabase } from '../../db/supabaseClient';
import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { calculateEarliestViableStartDate } from '../../services/PortfolioTimelineProjection';

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

describe('Campaign Priority Preemption', () => {
  const origLog = console.log;
  beforeAll(() => {
    (console as any).log = jest.fn();
  });
  afterAll(() => {
    (console as any).log = origLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (calculateEarliestViableStartDate as jest.Mock).mockResolvedValue(new Date('2026-04-01'));
  });

  describe('Test 1 — High priority preempts low', () => {
    it('includes PREEMPT_LOWER_PRIORITY_CAMPAIGN, sorted first for HIGH priority', async () => {
      const campaignA = 'campaign-a-uuid';
      const campaignB = 'campaign-b-uuid';
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
        campaignId: campaignB,
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'HIGH',
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      const preempt = result.tradeOffOptions!.find((o) => o.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      expect(preempt).toBeDefined();
      if (preempt && preempt.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN') {
        expect(preempt.conflictingCampaignId).toBe(campaignA);
      }
      const shift = result.tradeOffOptions!.find((o) => o.type === 'SHIFT_START_DATE');
      expect(shift).toBeDefined();
      expect(result.tradeOffOptions![0].type).toBe('PREEMPT_LOWER_PRIORITY_CAMPAIGN');
    });
  });

  describe('Test 2 — Same priority → no preemption', () => {
    it('no PREEMPT_LOWER_PRIORITY_CAMPAIGN when both NORMAL', async () => {
      const campaignA = 'campaign-a-uuid';
      const campaignB = 'campaign-b-uuid';
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
            data: [{ id: campaignA, priority_level: 'NORMAL' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        campaignId: campaignB,
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'NORMAL',
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      const preempt = result.tradeOffOptions!.find((o) => o.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      expect(preempt).toBeUndefined();
      const shift = result.tradeOffOptions!.find((o) => o.type === 'SHIFT_START_DATE');
      expect(shift).toBeDefined();
    });
  });

  describe('Test 3 — Critical priority', () => {
    it('PREEMPT first in ranking when CRITICAL', async () => {
      const campaignA = 'campaign-a-uuid';
      const campaignB = 'campaign-b-uuid';
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
            data: [{ id: campaignA, priority_level: 'NORMAL' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        campaignId: campaignB,
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'CRITICAL',
      });

      expect(result.status).toBe('NEGOTIATE');
      const preempt = result.tradeOffOptions!.find((o) => o.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      expect(preempt).toBeDefined();
      expect(result.tradeOffOptions![0].type).toBe('PREEMPT_LOWER_PRIORITY_CAMPAIGN');
    });
  });

  describe('Test 4 — Low priority campaign', () => {
    it('no PREEMPT suggestion when campaign is LOW', async () => {
      const campaignA = 'campaign-a-uuid';
      const campaignB = 'campaign-b-uuid';
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
            data: [{ id: campaignA, priority_level: 'NORMAL' }],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await evaluateCampaignDuration({
        requested_weeks: 12,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        campaignId: campaignB,
        companyId: 'company-1',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        requestedPostsPerWeek: 6,
        campaignPriorityLevel: 'LOW',
      });

      expect(result.status).toBe('NEGOTIATE');
      const preempt = (result.tradeOffOptions ?? []).find((o) => o.type === 'PREEMPT_LOWER_PRIORITY_CAMPAIGN');
      expect(preempt).toBeUndefined();
    });
  });
});
