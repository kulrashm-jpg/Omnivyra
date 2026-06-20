/**
 * Campaign duration authority — consolidation tests (Phase 6C-2).
 */
import {
  CAMPAIGN_DURATION_OPTIONS,
  ALL_CAMPAIGN_DURATIONS,
  SHORT_CAMPAIGN_DURATIONS,
  PLANNER_DURATIONS,
  BOLT_DURATION_OPTIONS,
  toDurationOptions,
} from '../../../lib/shared/campaignDuration';
import { determinePostsPerWeek } from '../../services/postDensityEngine';

describe('Phase 6C-2 — campaign duration authority', () => {
  test('1. authority contains 1–12', () => {
    expect(CAMPAIGN_DURATION_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ALL_CAMPAIGN_DURATIONS).toBe(CAMPAIGN_DURATION_OPTIONS);
  });

  test('4. BOLT subset (1–4) derives from authority via filter', () => {
    expect(SHORT_CAMPAIGN_DURATIONS).toEqual([1, 2, 3, 4]);
    expect(SHORT_CAMPAIGN_DURATIONS).toEqual(CAMPAIGN_DURATION_OPTIONS.filter((w) => w <= 4));
  });

  test('3. planner curated set preserved (supports up to 12)', () => {
    expect(PLANNER_DURATIONS).toEqual([1, 2, 4, 6, 8, 10, 12]);
    expect(PLANNER_DURATIONS).toContain(12);
  });

  test('BOLT labels match legacy exactly ("1 Week" / "N Weeks")', () => {
    expect(BOLT_DURATION_OPTIONS).toEqual([
      { value: 1, label: '1 Week' },
      { value: 2, label: '2 Weeks' },
      { value: 3, label: '3 Weeks' },
      { value: 4, label: '4 Weeks' },
    ]);
  });

  test('lowercase label style preserved (recommendation card)', () => {
    expect(toDurationOptions(SHORT_CAMPAIGN_DURATIONS, { lowercase: true })).toEqual([
      { value: 1, label: '1 week' },
      { value: 2, label: '2 weeks' },
      { value: 3, label: '3 weeks' },
      { value: 4, label: '4 weeks' },
    ]);
  });

  test('7. post-density cadence is INDEPENDENT of duration (no behavior change)', () => {
    // determinePostsPerWeek ignores campaignDurationWeeks — varying it must not
    // change the result for the same momentum/pressure.
    const base = { momentumLevel: 'normal' as const, pressureLevel: 'normal' as const };
    const d1 = determinePostsPerWeek({ ...base, campaignDurationWeeks: 1 });
    const d12 = determinePostsPerWeek({ ...base, campaignDurationWeeks: 12 });
    expect(d1).toBe(d12);
  });
});
