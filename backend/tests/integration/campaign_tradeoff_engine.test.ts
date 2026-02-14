/**
 * Integration tests for TradeOffGenerator.
 * Tests: capacity limiting (all three options), inventory limiting only, approved (no options).
 */

import { generateTradeOffOptions } from '../../services/TradeOffGenerator';
import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';

describe('TradeOffGenerator', () => {
  describe('Test 1 — Capacity Limiting', () => {
    it('returns REDUCE_FREQUENCY, EXTEND_DURATION, INCREASE_CAPACITY when capacity limits', () => {
      const options = generateTradeOffOptions({
        requestedDurationWeeks: 4,
        requestedPostsPerWeek: 5,
        totalInventory: 20,
        maxWeeksAllowed: 10,
        limitingConstraints: [{ name: 'production_capacity', status: 'LIMITING', max_weeks_allowed: 10, reasoning: 'Team capacity limits' }],
        availableCapacity: 2,
      });

      const types = options.map((o) => o.type);
      expect(types).toContain('REDUCE_FREQUENCY');
      expect(types).toContain('EXTEND_DURATION');
      expect(types).toContain('INCREASE_CAPACITY');

      const reduce = options.find((o) => o.type === 'REDUCE_FREQUENCY');
      expect(reduce?.newPostsPerWeek).toBe(2);
      expect(reduce?.newDurationWeeks).toBe(10); // ceil(20/2)

      const increase = options.find((o) => o.type === 'INCREASE_CAPACITY');
      expect(increase?.requiredAdditionalCapacity).toBe(3); // 5 - 2

      const extend = options.find((o) => o.type === 'EXTEND_DURATION');
      expect(extend?.newDurationWeeks).toBe(10);
    });
  });

  describe('Test 2 — Inventory Limiting Only', () => {
    it('returns EXTEND_DURATION only when inventory limits', () => {
      const options = generateTradeOffOptions({
        requestedDurationWeeks: 8,
        requestedPostsPerWeek: 5,
        totalInventory: 20,
        maxWeeksAllowed: 4,
        limitingConstraints: [{ name: 'inventory', status: 'LIMITING', max_weeks_allowed: 4, reasoning: 'Insufficient content' }],
        availableCapacity: 10, // plenty of capacity
      });

      expect(options.length).toBe(1);
      expect(options[0].type).toBe('EXTEND_DURATION');
      expect(options[0].newDurationWeeks).toBe(4);
      expect(options[0].reasoning).toContain('Reduce campaign duration');
    });
  });

  describe('Test 3 — Approved', () => {
    it('evaluateCampaignDuration returns no tradeOffOptions when APPROVED', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 50,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
      });

      expect(result.status).toBe('APPROVED');
      expect(result.tradeOffOptions).toBeUndefined();
    });
  });

  describe('Test 4 — Zero Viable Duration', () => {
    it('returns REJECTED when max_weeks_allowed=0, includes INCREASE_CAPACITY, no NEGOTIATE', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 1, // floor(1/5)=0 → max_weeks=0
        availableCapacity: 0, // override: effectively zero capacity
      });

      expect(result.status).toBe('REJECTED');
      expect(result.max_weeks_allowed).toBe(0);
      expect(result.tradeOffOptions).toBeDefined();
      const increase = result.tradeOffOptions!.find((o) => o.type === 'INCREASE_CAPACITY');
      expect(increase).toBeDefined();
      expect(increase!.requiredAdditionalCapacity).toBe(5);
    });
  });

  describe('NEGOTIATE with trade-off options', () => {
    it('evaluateCampaignDuration returns tradeOffOptions when NEGOTIATE (positive max)', async () => {
      // Budget limits to 2 weeks. Requested 8 > 2 → NEGOTIATE
      const result = await evaluateCampaignDuration({
        requested_weeks: 8,
        existing_content_count: 100,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 1000,
        cost_per_week: 500, // budget allows 2 weeks
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      expect(Array.isArray(result.tradeOffOptions)).toBe(true);
      expect(result.tradeOffOptions!.length).toBeGreaterThan(0);
      result.tradeOffOptions!.forEach((opt) => {
        expect(opt.type).toMatch(/^(EXTEND_DURATION|REDUCE_FREQUENCY|INCREASE_CAPACITY|SHIFT_START_DATE|PREEMPT_LOWER_PRIORITY_CAMPAIGN)$/);
        expect(opt.reasoning).toBeTruthy();
      });
    });
  });
});
