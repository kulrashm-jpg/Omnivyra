/**
 * Governance Contract — Status Determinism Test.
 * Verifies status semantics: REJECTED, NEGOTIATE, APPROVED.
 * Ensures no additional statuses appear.
 */

import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { GOVERNANCE_STATUS_RULES } from '../../governance/GovernanceContract';

describe('Governance Contract — Status Determinism', () => {
  it('1. Blocking constraint → always REJECTED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 0,
      expected_posts_per_week: 5,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.blocking_constraints.length).toBeGreaterThan(0);
    expect(result.max_weeks_allowed).toBe(0);
  });

  it('2. max_weeks_allowed = 0 → REJECTED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 4,
      existing_content_count: 20,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 1,
      availableCapacity: 0,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.max_weeks_allowed).toBe(0);
  });

  it('3. Limiting but viable → NEGOTIATE', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 20,
      existing_content_count: 30,
      expected_posts_per_week: 5,
    });
    expect(result.status).toBe('NEGOTIATE');
    expect(result.max_weeks_allowed).toBeGreaterThan(0);
    expect(result.limiting_constraints.length).toBeGreaterThan(0);
  });

  it('4. No constraints → APPROVED', async () => {
    const result = await evaluateCampaignDuration({
      requested_weeks: 4,
      existing_content_count: 50,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      total_budget: 10000,
      cost_per_week: 500,
    });
    expect(result.status).toBe('APPROVED');
    expect(result.blocking_constraints).toEqual([]);
    expect(result.max_weeks_allowed).toBeGreaterThanOrEqual(4);
  });

  it('5. Status set matches GOVERNANCE_STATUS_RULES — no additional statuses', () => {
    const allowedStatuses = Object.keys(GOVERNANCE_STATUS_RULES);
    expect(allowedStatuses).toContain('REJECTED');
    expect(allowedStatuses).toContain('NEGOTIATE');
    expect(allowedStatuses).toContain('APPROVED');
    expect(allowedStatuses.length).toBe(3);
  });

  it('6. All evaluation results return exact status strings', async () => {
    const validStatuses = ['APPROVED', 'NEGOTIATE', 'REJECTED'] as const;
    const result1 = await evaluateCampaignDuration({
      requested_weeks: 4,
      existing_content_count: 50,
      expected_posts_per_week: 5,
    });
    const result2 = await evaluateCampaignDuration({
      requested_weeks: 100,
      existing_content_count: 10,
      expected_posts_per_week: 5,
    });
    const result3 = await evaluateCampaignDuration({
      requested_weeks: 12,
      existing_content_count: 0,
      expected_posts_per_week: 5,
    });
    expect(validStatuses).toContain(result1.status);
    expect(validStatuses).toContain(result2.status);
    expect(validStatuses).toContain(result3.status);
  });
});
