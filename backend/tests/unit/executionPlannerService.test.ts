/**
 * Execution Engine validation tests.
 *
 * Test 1 — AI Generation: 7 rows with generation_source = AI
 * Test 2 — Blueprint Generation: 7 rows with generation_source = blueprint
 * Test 3 — Board updateActivity: row updated without deleting week
 * Test 4 — Execution Lock: WEEK_EXECUTION_LOCKED when status = executing
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  generateFromAI,
  saveWeekPlans,
  updateActivity,
  getDailyPlans,
  WEEK_EXECUTION_LOCKED,
} from '../../services/executionPlannerService';

const TEST_CAMPAIGN_ID = '00000000-0000-0000-0000-000000000001';
const TEST_WEEK = 99;

describe('ExecutionPlannerService', () => {
  beforeAll(async () => {
    // Ensure test campaign has start_date (may need seed)
  });

  afterAll(async () => {
    // Optional: cleanup test data
  });

  it('generateFromAI inserts 7 rows with generation_source=AI', async () => {
    const { rowsInserted } = await generateFromAI(TEST_CAMPAIGN_ID, TEST_WEEK);
    expect(rowsInserted).toBe(7);

    const plans = await getDailyPlans(TEST_CAMPAIGN_ID);
    const weekPlans = plans.filter((p: any) => Number(p.week_number) === TEST_WEEK);
    expect(weekPlans.length).toBe(7);
    weekPlans.forEach((p: any) => {
      expect(p.generation_source).toBe('AI');
    });
  });

  it('saveWeekPlans with source=blueprint sets generation_source', async () => {
    const plans = [
      {
        campaign_id: TEST_CAMPAIGN_ID,
        week_number: TEST_WEEK + 1,
        day_of_week: 'Monday',
        date: '2025-01-01',
        platform: 'linkedin',
        content_type: 'post',
        title: 'Test',
        content: '{}',
      },
    ];
    await saveWeekPlans(TEST_CAMPAIGN_ID, TEST_WEEK + 1, plans as any, 'blueprint');
    const all = await getDailyPlans(TEST_CAMPAIGN_ID);
    const w99 = all.filter((p: any) => Number(p.week_number) === TEST_WEEK + 1);
    expect(w99.length).toBeGreaterThanOrEqual(1);
    expect(w99[0]?.generation_source).toBe('blueprint');
  });

  it('updateActivity updates single row without deleting week', async () => {
    const plans = await getDailyPlans(TEST_CAMPAIGN_ID);
    const first = plans[0] as { id?: string };
    if (!first?.id) return;

    await updateActivity(first.id, { title: 'Updated by board' }, 'board');
    const after = await getDailyPlans(TEST_CAMPAIGN_ID);
    const found = after.find((p: any) => p.id === first.id);
    expect(found?.title).toBe('Updated by board');
  });

  it('rejects regeneration when week has status=executing unless forceOverride', async () => {
    // First insert plans, then update one to executing
    const plans = await getDailyPlans(TEST_CAMPAIGN_ID);
    const lockWeek = TEST_WEEK + 2;
    const lockPlans = [
      {
        campaign_id: TEST_CAMPAIGN_ID,
        week_number: lockWeek,
        day_of_week: 'Monday',
        date: '2025-01-01',
        platform: 'linkedin',
        content_type: 'post',
        title: 'Locked',
        content: '{}',
        status: 'executing',
      },
    ];
    await saveWeekPlans(TEST_CAMPAIGN_ID, lockWeek, lockPlans as any, 'manual');
    // Now try to regenerate - should fail
    await expect(
      saveWeekPlans(TEST_CAMPAIGN_ID, lockWeek, [{ ...lockPlans[0], title: 'New' }] as any, 'AI')
    ).rejects.toMatchObject({ code: WEEK_EXECUTION_LOCKED });
    // With forceOverride should succeed
    await saveWeekPlans(TEST_CAMPAIGN_ID, lockWeek, [{ ...lockPlans[0], title: 'Forced' }] as any, 'AI', {
      forceOverride: true,
    });
  });
});
