/**
 * Integration tests for Portfolio Start Date Shift Intelligence (Stage 7).
 * Tests: fully blocked overlap, partial capacity recovery, no overlap.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { evaluatePortfolioConstraints } from '../../services/PortfolioConstraintEvaluator';
import { calculateEarliestViableStartDate } from '../../services/PortfolioTimelineProjection';
import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';

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

describe('Portfolio Start Date Shift', () => {
  const origLog = console.log;
  beforeAll(() => {
    (console as any).log = jest.fn();
  });
  afterAll(() => {
    (console as any).log = origLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Test 1 — Fully blocked overlap', () => {
    it('returns REJECTED with SHIFT_START_DATE when capacity fully blocked', async () => {
      (calculateEarliestViableStartDate as jest.Mock).mockResolvedValue(new Date('2026-03-31'));

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

      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        campaignId: 'campaign-b',
        companyId: 'company-1',
        startDate: rangeStart,
        endDate: rangeEnd,
        requestedPostsPerWeek: 5,
      });

      expect(result.status).toBe('REJECTED');
      expect(result.tradeOffOptions).toBeDefined();
      const shift = result.tradeOffOptions!.find((o) => o.type === 'SHIFT_START_DATE');
      expect(shift).toBeDefined();
      expect(shift!.type).toBe('SHIFT_START_DATE');
      if (shift && shift.type === 'SHIFT_START_DATE') {
        expect(shift.newStartDate).toBeDefined();
        expect(new Date(shift.newStartDate).getTime()).toBeGreaterThanOrEqual(
          new Date('2026-03-31').getTime()
        );
      }
    });
  });

  describe('Test 2 — Partial capacity recovery', () => {
    it('returns NEGOTIATE with SHIFT_START_DATE when partial overlap', async () => {
      (calculateEarliestViableStartDate as jest.Mock).mockResolvedValue(new Date('2026-03-16'));

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
              { campaign_id: 'campaign-a', weekly_capacity_reserved: 8, start_date: rangeStart, end_date: '2026-03-15' },
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
        requested_weeks: 8,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        campaignId: 'campaign-b',
        companyId: 'company-1',
        startDate: rangeStart,
        endDate: rangeEnd,
        requestedPostsPerWeek: 5,
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      const shift = result.tradeOffOptions!.find((o) => o.type === 'SHIFT_START_DATE');
      expect(shift).toBeDefined();
    });
  });

  describe('Test 3 — No overlap', () => {
    it('does not include SHIFT_START_DATE when no team overlap', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => chain({ data: null, error: null }));

      const output = await evaluatePortfolioConstraints({
        campaignId: 'campaign-orphan',
        companyId: 'company-1',
        requestedDurationWeeks: 4,
        requestedPostsPerWeek: 5,
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      });

      expect(output.constraints).toEqual([]);
      expect(output.suggestedTradeOffs).toBeUndefined();
    });
  });
});
