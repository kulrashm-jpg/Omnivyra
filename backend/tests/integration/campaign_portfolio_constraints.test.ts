/**
 * Integration tests for PortfolioConstraintEvaluator.
 * Tests: overlapping capacity limit, full block, parallel limit, no team assigned.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
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

describe('PortfolioConstraintEvaluator', () => {
  const origLog = console.log;
  beforeAll(() => {
    (console as any).log = jest.fn();
  });
  afterAll(() => {
    (console as any).log = origLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 1 — Overlapping capacity limit: Team 10, A reserves 8, B requests 5 → LIMITING', async () => {
    const campaignB = 'campaign-b';
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
              campaign_id: 'campaign-a',
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

    const results = output.constraints;
    expect(results.length).toBeGreaterThan(0);
    const overlap = results.find((r) => r.name === 'team_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.status).toBe('LIMITING');
    expect(overlap!.reasoning).toContain('2');
  });

  it('Test 2 — Full block: Team 10, A reserves 10, B requests 4 → BLOCKING', async () => {
    const campaignB = 'campaign-b';
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
              campaign_id: 'campaign-a',
              weekly_capacity_reserved: 10,
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
      return chain({ data: null, error: null });
    });

    const output = await evaluatePortfolioConstraints({
      campaignId: campaignB,
      companyId: 'company-1',
      requestedDurationWeeks: 4,
      requestedPostsPerWeek: 4,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    const results = output.constraints;
    expect(results.length).toBeGreaterThan(0);
    const overlap = results.find((r) => r.name === 'team_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.status).toBe('BLOCKING');
    expect(overlap!.max_weeks_allowed).toBe(0);
  });

  it('Test 3 — Parallel campaign limit: max_parallel=2, already 2 overlapping → LIMITING', async () => {
    const campaignC = 'campaign-c';
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
            { campaign_id: 'campaign-a', weekly_capacity_reserved: 2, start_date: rangeStart, end_date: rangeEnd },
            { campaign_id: 'campaign-b', weekly_capacity_reserved: 2, start_date: rangeStart, end_date: rangeEnd },
          ],
          error: null,
        });
      }
      if (table === 'team_capacity') {
        return chain({ data: { max_posts_per_week: 20, max_parallel_campaigns: 2 }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const output = await evaluatePortfolioConstraints({
      campaignId: campaignC,
      companyId: 'company-1',
      requestedDurationWeeks: 4,
      requestedPostsPerWeek: 3,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    const results = output.constraints;
    const parallel = results.find((r) => r.name === 'parallel_campaigns');
    expect(parallel).toBeDefined();
    expect(parallel!.status).toBe('LIMITING');
  });

  it('Test 4 — No team assigned → PASS (empty results)', async () => {
    (supabase.from as jest.Mock).mockImplementation(() =>
      chain({ data: null, error: null })
    );

    const output = await evaluatePortfolioConstraints({
      campaignId: 'campaign-orphan',
      companyId: 'company-1',
      requestedDurationWeeks: 4,
      requestedPostsPerWeek: 5,
      startDate: '2025-03-01',
      endDate: '2025-03-31',
    });

    expect(output.constraints).toEqual([]);
  });
});
