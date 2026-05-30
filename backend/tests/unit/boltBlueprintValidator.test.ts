/**
 * Blueprint validator (Part 5) regression tests.
 */

import {
  validateBoltBlueprint,
  assertValidBoltBlueprint,
} from '../../../lib/shared/bolt/validateBoltBlueprint';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

describe('validateBoltBlueprint', () => {
  test('rejects missing/empty weeks', () => {
    expect(validateBoltBlueprint(null).errors[0].code).toBe(BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS);
    expect(validateBoltBlueprint({ weeks: [] }).errors[0].code).toBe(BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS);
  });

  test('rejects a week that is not an object', () => {
    const r = validateBoltBlueprint({ weeks: ['not-a-week'] });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE);
  });

  test('rejects a week with no platforms', () => {
    const r = validateBoltBlueprint({
      weeks: [{
        week_number: 1,
        activities: [{ content_type: 'post', cta: 'click' }],
      }],
    });
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain(BOLT_ERROR_CODES.BLUEPRINT_MISSING_PLATFORM_MAPPING);
  });

  test('rejects a blueprint with zero activities', () => {
    const r = validateBoltBlueprint({
      weeks: [{
        week_number: 1,
        platform_allocation: { linkedin: 0 },
      }],
    });
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT)).toBe(true);
  });

  test('rejects unsupported content types', () => {
    const r = validateBoltBlueprint({
      weeks: [{
        week_number: 1,
        platform_allocation: { linkedin: 1 },
        activities: [{ content_type: 'webinar', cta: 'register' }],
      }],
    });
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE);
  });

  test('accepts a minimally-valid blueprint', () => {
    const r = validateBoltBlueprint({
      weeks: [{
        week_number: 1,
        platform_allocation: { linkedin: 3 },
        activities: [
          { content_type: 'post', cta: 'learn more' },
          { content_type: 'tweet', cta: 'visit' },
          { content_type: 'article', cta: 'read' },
        ],
        cta: 'overall cta',
      }],
    });
    expect(r.ok).toBe(true);
    expect(r.totals.weeks).toBe(1);
    expect(r.totals.activities).toBe(3);
    expect(r.totals.platforms).toBe(1);
    expect(r.totals.ctas).toBeGreaterThan(0);
  });

  test('extracts activity counts from content_type_mix when no activities array', () => {
    const r = validateBoltBlueprint({
      weeks: [{
        week_number: 1,
        platform_allocation: { linkedin: 5 },
        content_type_mix: ['5 post', '2 tweet'],
        cta: 'cta',
      }],
    });
    expect(r.ok).toBe(true);
    expect(r.totals.activities).toBe(7);
  });
});

describe('assertValidBoltBlueprint', () => {
  test('throws BoltError with BLUEPRINT_* code', () => {
    expect(() => assertValidBoltBlueprint({ weeks: [] })).toThrow(BoltError);
    try {
      assertValidBoltBlueprint({ weeks: [] });
    } catch (e) {
      expect((e as BoltError).code).toBe(BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS);
      expect((e as BoltError).category).toBe('BLUEPRINT_FAILURE');
    }
  });
});
