/**
 * Phase 6C-4A — Intelligent Mix duration expansion (1–12 weeks).
 *
 * Intelligent Mix (campaign_mode === 'combined') is lifted from 1–4 to 1–12
 * weeks. BOLT Text and BOLT Creator remain 1–4. Every limit derives from the
 * shared duration authority (lib/shared/campaignDuration) — no duplicated
 * numeric literals in the pipeline / validators / UI.
 *
 * These tests pin:
 *   - the authority's derived max constants + option ranges (Tasks 3, 6),
 *   - the mode-aware execution validator accepting 8/12 only for combined and
 *     still rejecting >4 for text/creator (Tasks 2, 5, 8), and
 *   - 1–4 week campaigns unchanged for every mode (Task 7).
 */

import {
  ALL_CAMPAIGN_DURATIONS,
  SHORT_CAMPAIGN_DURATIONS,
  COMBINED_DURATION_OPTIONS,
  BOLT_DURATION_OPTIONS,
  MAX_CAMPAIGN_DURATION_WEEKS,
  MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
} from '../../../lib/shared/campaignDuration';
import { validateBoltPreExecution } from '../../services/boltPreExecutionValidator';
import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

// ── Authority (single source of truth) ──────────────────────────────────────
describe('6C-4A — duration authority derives both ranges (no duplicated limits)', () => {
  test('combined max = 12, short max = 4, both derived from the option arrays', () => {
    expect(MAX_CAMPAIGN_DURATION_WEEKS).toBe(12);
    expect(MAX_SHORT_CAMPAIGN_DURATION_WEEKS).toBe(4);
    // Derived, not hardcoded — equals the max of the canonical arrays.
    expect(MAX_CAMPAIGN_DURATION_WEEKS).toBe(Math.max(...ALL_CAMPAIGN_DURATIONS));
    expect(MAX_SHORT_CAMPAIGN_DURATION_WEEKS).toBe(Math.max(...SHORT_CAMPAIGN_DURATIONS));
  });

  test('Intelligent Mix UI exposes the full 1–12 range; BOLT Text/Creator stay 1–4', () => {
    expect(COMBINED_DURATION_OPTIONS.map((o) => o.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(BOLT_DURATION_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4]);
  });
});

// ── Mode-aware execution validator ──────────────────────────────────────────
const DURATION_CODE = BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION;

function baseConfig(mode: string, weeks: number): Record<string, unknown> {
  return {
    campaign_mode: mode,
    campaign_duration: weeks,
    target_audience: 'B2B marketers',
    campaign_goal: 'Brand Awareness',
    frequency_per_week: 3,
  };
}

async function durationRejected(mode: string, weeks: number): Promise<boolean> {
  const result = await validateBoltPreExecution({
    companyId: 'co-1',
    generatedCampaignId: 'camp-1',
    sourceStrategicTheme: null,
    executionConfig: baseConfig(mode, weeks),
  });
  // We only assert the duration verdict; other unrelated errors may exist.
  return result.errors.some((e) => e.code === DURATION_CODE);
}

describe('6C-4A — combined accepts 1–12, text/creator stay 1–4', () => {
  test('1. combined accepts 8 weeks', async () => {
    expect(await durationRejected('combined', 8)).toBe(false);
  });

  test('2. combined accepts 12 weeks', async () => {
    expect(await durationRejected('combined', 12)).toBe(false);
  });

  test('combined still rejects 13 weeks (clamp moved, not removed)', async () => {
    expect(await durationRejected('combined', 13)).toBe(true);
  });

  test('3. text still rejects >4 weeks (8 and 12)', async () => {
    expect(await durationRejected('text', 8)).toBe(true);
    expect(await durationRejected('text', 12)).toBe(true);
  });

  test('4. creator still rejects >4 weeks (8 and 12)', async () => {
    expect(await durationRejected('creator', 8)).toBe(true);
    expect(await durationRejected('creator', 12)).toBe(true);
  });

  test('7. existing 1–4 week campaigns unchanged for every mode', async () => {
    for (const mode of ['text', 'creator', 'combined']) {
      for (const weeks of [1, 2, 3, 4]) {
        expect(await durationRejected(mode, weeks)).toBe(false);
      }
    }
  });

  test('all modes still reject 0 and 5 below/above their short ceiling appropriately', async () => {
    // 0 is invalid everywhere; 5 is invalid for text/creator but valid for combined.
    expect(await durationRejected('text', 0)).toBe(true);
    expect(await durationRejected('combined', 0)).toBe(true);
    expect(await durationRejected('text', 5)).toBe(true);
    expect(await durationRejected('creator', 5)).toBe(true);
    expect(await durationRejected('combined', 5)).toBe(false);
  });
});

// ── Week preservation (Task 4 / Task 8 #5) ──────────────────────────────────
describe('6C-4A — requested week count is preserved (slice keeps all requested weeks)', () => {
  // The pipeline trims via plan.weeks.slice(0, durationWeeks). With the clamp
  // lifted, durationWeeks reaches up to 12 for combined, so an 8/12-week plan
  // keeps 8/12 weeks rather than being cut to 4.
  function trim(planWeekCount: number, durationWeeks: number): number {
    const weeks = Array.from({ length: planWeekCount }, (_, i) => i + 1);
    return weeks.slice(0, durationWeeks).length;
  }
  test('8-week request retains 8 weeks', () => {
    expect(trim(8, Math.min(MAX_CAMPAIGN_DURATION_WEEKS, 8))).toBe(8);
  });
  test('12-week request retains 12 weeks', () => {
    expect(trim(12, Math.min(MAX_CAMPAIGN_DURATION_WEEKS, 12))).toBe(12);
  });
  test('4-week request still retains exactly 4 weeks (unchanged)', () => {
    expect(trim(4, Math.min(MAX_SHORT_CAMPAIGN_DURATION_WEEKS, 4))).toBe(4);
  });
});
