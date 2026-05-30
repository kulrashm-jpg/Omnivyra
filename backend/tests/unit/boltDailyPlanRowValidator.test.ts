/**
 * Daily-plan row validator (Part 3 of closure pass) regression tests.
 */

import {
  validateDailyPlanRow,
  assertDailyPlanRowValid,
} from '../../../lib/shared/bolt/validateDailyPlanRow';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

function row(overrides: Record<string, unknown> = {}) {
  return {
    week_number: 1,
    platform: 'linkedin',
    content_type: 'post',
    cta: 'visit site',
    ...overrides,
  };
}

describe('validateDailyPlanRow — happy path', () => {
  test('accepts a complete valid row', () => {
    const r = validateDailyPlanRow(row());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe('validateDailyPlanRow — invalid platform', () => {
  test('missing platform produces DAILY_PLAN_INVALID_PLATFORM', () => {
    const r = validateDailyPlanRow(row({ platform: '' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM)).toBe(true);
  });
});

describe('validateDailyPlanRow — invalid content type', () => {
  test('unregistered content_type produces DAILY_PLAN_INVALID_CONTENT_TYPE', () => {
    const r = validateDailyPlanRow(row({ content_type: 'webinar' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE)).toBe(true);
  });
});

describe('validateDailyPlanRow — invalid week', () => {
  test('non-integer week_number rejected', () => {
    const r = validateDailyPlanRow(row({ week_number: 1.5 }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK)).toBe(true);
  });
  test('zero week_number rejected', () => {
    const r = validateDailyPlanRow(row({ week_number: 0 }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK)).toBe(true);
  });
});

describe('validateDailyPlanRow — activity_id', () => {
  test('requires_activity=true + missing activity_id', () => {
    const r = validateDailyPlanRow(row({ requires_activity: true, activity_id: '' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_ACTIVITY)).toBe(true);
  });
  test('requires_activity=false (default) doesn\'t require activity_id', () => {
    const r = validateDailyPlanRow(row({ activity_id: null }));
    expect(r.ok).toBe(true);
  });
});

describe('validateDailyPlanRow — schedule', () => {
  test('requires_schedule=true + missing scheduled_for', () => {
    const r = validateDailyPlanRow(row({ requires_schedule: true, scheduled_for: null }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE)).toBe(true);
  });
  test('requires_schedule=true + invalid scheduled_for', () => {
    const r = validateDailyPlanRow(row({ requires_schedule: true, scheduled_for: 'not-a-date' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE)).toBe(true);
  });
  test('requires_schedule=true + past scheduled_for', () => {
    const r = validateDailyPlanRow(row({
      requires_schedule: true,
      scheduled_for: '2020-01-01T00:00:00Z',
    }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE)).toBe(true);
  });
  test('requires_schedule=true + future scheduled_for passes', () => {
    const r = validateDailyPlanRow(row({
      requires_schedule: true,
      scheduled_for: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    expect(r.ok).toBe(true);
  });
});

describe('validateDailyPlanRow — CTA', () => {
  test('missing CTA emits DAILY_PLAN_INVALID_CTA but is warning-class', () => {
    const r = validateDailyPlanRow(row({ cta: '' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA)).toBe(true);
    // strict path ignores CTA-only failures
    expect(() => assertDailyPlanRowValid(row({ cta: '' }))).not.toThrow();
  });
});

describe('assertDailyPlanRowValid', () => {
  test('throws BoltError with first hard error', () => {
    expect(() => assertDailyPlanRowValid(row({ platform: '', cta: '' }))).toThrow(BoltError);
    try {
      assertDailyPlanRowValid(row({ platform: '', cta: '' }));
    } catch (e) {
      expect((e as BoltError).code).toBe(BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM);
    }
  });
});
