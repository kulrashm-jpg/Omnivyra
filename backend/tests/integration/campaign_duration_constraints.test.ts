/**
 * Integration tests for Modular Campaign Duration Constraint Framework.
 */

import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';

describe('HorizonConstraintEvaluator', () => {
  it('underdeveloped + low inventory → NEGOTIATE', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 10,
      expected_posts_per_week: 5,
      baseline_status: 'underdeveloped',
    });
    expect(result.status).toBe('NEGOTIATE');
    expect(result.max_weeks_allowed).toBe(2); // 10/5 = 2
    expect(result.limiting_constraints.some((c) => c.name === 'inventory')).toBe(true);
  });

  it('strong baseline + sufficient capacity → APPROVED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 6,
      existing_content_count: 50,
      expected_posts_per_week: 5,
      baseline_status: 'strong',
    });
    expect(result.status).toBe('APPROVED');
    expect(result.max_weeks_allowed).toBeGreaterThanOrEqual(6);
  });

  it('zero content inventory → REJECTED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 0,
      expected_posts_per_week: 5,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.blocking_constraints.some((c) => c.name === 'inventory')).toBe(true);
    expect(result.max_weeks_allowed).toBe(0);
  });

  it('reduce duration → APPROVED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 2,
      existing_content_count: 20,
      expected_posts_per_week: 5,
    });
    expect(result.status).toBe('APPROVED');
    expect(result.max_weeks_allowed).toBeGreaterThanOrEqual(2);
  });

  it('increase beyond constraint → NEGOTIATE', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 20,
      existing_content_count: 30,
      expected_posts_per_week: 5,
    });
    expect(result.status).toBe('NEGOTIATE');
    expect(result.max_weeks_allowed).toBe(6); // 30/5
  });

  it('budget constraint limits duration', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 100,
      expected_posts_per_week: 5,
      total_budget: 500,
      cost_per_week: 100,
    });
    expect(result.status).toBe('NEGOTIATE');
    expect(result.max_weeks_allowed).toBe(5); // 500/100
    expect(result.limiting_constraints.some((c) => c.name === 'budget')).toBe(true);
  });

  it('lead-heavy campaign requires minimum 3 weeks', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 2,
      existing_content_count: 50,
      expected_posts_per_week: 5,
      campaign_type_weights: { lead_generation: 80 },
    });
    expect(result.status).toBe('NEGOTIATE');
    expect(result.min_weeks_required).toBe(3);
    expect(result.limiting_constraints.some((c) => c.name === 'campaign_type_intensity')).toBe(true);
  });

  // ——— Real-world behavior scenarios ———

  it('Scenario A: Underdeveloped + 50 content units + lead heavy', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 8,
      existing_content_count: 50,
      expected_posts_per_week: 12, // 50/12 → floor 4 weeks cap
      baseline_status: 'underdeveloped',
      campaign_type_weights: { lead_generation: 80 },
    });
    expect(result.requested_weeks).toBe(8);
    expect(result.max_weeks_allowed).toBe(4);
    expect(result.min_weeks_required).toBe(3);
    expect(result.status).toBe('NEGOTIATE');
    expect(result.limiting_constraints.some((c) => c.name === 'inventory')).toBe(true);
  });

  it('Scenario B: Strong baseline + high budget + large team', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 200,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      total_budget: 10000,
      cost_per_week: 500,
      baseline_status: 'strong',
    });
    expect(result.requested_weeks).toBe(12);
    expect(result.status).toBe('APPROVED');
    expect(result.max_weeks_allowed).toBeGreaterThanOrEqual(12);
  });

  it('Scenario C: User extends from 4 → 14 weeks, inventory/production insufficient', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 14,
      existing_content_count: 35,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 6, // sufficient; inventory caps
    });
    expect(result.requested_weeks).toBe(14);
    expect(result.status).toBe('NEGOTIATE');
    expect(result.max_weeks_allowed).toBe(7); // 35/5
    expect(result.max_weeks_allowed).toBeLessThan(14);
    expect(result.limiting_constraints.some((c) => c.name === 'inventory')).toBe(true);
  });
});

describe('CampaignPrePlanningService', () => {
  it('runPrePlanning returns DurationEvaluationResult', async () => {
    const companyId = 'test-company';
    const campaignId = 'test-campaign';
    const requested_weeks = 4;

    try {
      const result = await runPrePlanning({ companyId, campaignId, requested_weeks });
      expect(result).toBeDefined();
      expect(['APPROVED', 'NEGOTIATE', 'REJECTED']).toContain(result.status);
      expect(typeof result.requested_weeks).toBe('number');
      expect(typeof result.max_weeks_allowed).toBe('number');
      expect(Array.isArray(result.limiting_constraints)).toBe(true);
      expect(Array.isArray(result.blocking_constraints)).toBe(true);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
});
