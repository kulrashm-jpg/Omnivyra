/**
 * Classifier regression tests for the closure pass.
 *
 * Verifies that:
 *   - BoltError instances bypass message guessing and use their declared category.
 *   - Stage-name fallback resolves every BOLT stage to a non-UNKNOWN category.
 *   - All new closure-pass codes have an entry in BOLT_ERROR_CODE_CATEGORY.
 */

import { classifyBoltFailure } from '../../../lib/shared/bolt/classifyBoltFailure';
import {
  BoltError,
  BOLT_ERROR_CODES,
  BOLT_ERROR_CODE_CATEGORY,
  BOLT_ERROR_CODE_FRIENDLY_MESSAGES,
  type BoltErrorCode,
} from '../../../lib/shared/bolt/boltErrorCodes';

describe('classifyBoltFailure — BoltError fast-path', () => {
  test.each([
    BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED,
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    BOLT_ERROR_CODES.CREATOR_ASSET_RENDER_FAILED,
    BOLT_ERROR_CODES.AI_PLAN_INVALID,
    BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID,
    BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
  ])('%s short-circuits to its declared category', (code) => {
    const err = new BoltError(code as BoltErrorCode, `synthetic ${code}`);
    const c = classifyBoltFailure({ error: err, stage: 'whatever' });
    expect(c.category).toBe(BOLT_ERROR_CODE_CATEGORY[code as BoltErrorCode]);
    expect(c.category).not.toBe('UNKNOWN');
  });
});

describe('classifyBoltFailure — stage-name fallback eliminates UNKNOWN', () => {
  test.each([
    ['source-recommendation', 'VALIDATION_ERROR'],
    ['commit-plan', 'BLUEPRINT_FAILURE'],
    ['ai/plan', 'PLAN_PARSE_FAILURE'],
    ['ai-plan', 'PLAN_PARSE_FAILURE'],
    ['generate-weekly-structure', 'DAILY_PLAN_FAILURE'],
    ['schedule-structured-plan', 'SCHEDULING_FAILURE'],
    ['creator-asset-generation', 'DAILY_PLAN_FAILURE'],
    ['pipeline-outer', 'PROVIDER_TIMEOUT'],
  ])('stage=%s + generic Error → category %s', (stage, expected) => {
    const c = classifyBoltFailure({
      error: new Error('totally generic message with no signals'),
      stage,
    });
    expect(c.category).toBe(expected);
  });
});

describe('Taxonomy completeness', () => {
  test('every BoltErrorCode has a category mapping', () => {
    for (const code of Object.values(BOLT_ERROR_CODES)) {
      expect(BOLT_ERROR_CODE_CATEGORY[code as BoltErrorCode]).toBeDefined();
    }
  });
  test('every BoltErrorCode has a friendly message', () => {
    for (const code of Object.values(BOLT_ERROR_CODES)) {
      expect(BOLT_ERROR_CODE_FRIENDLY_MESSAGES[code as BoltErrorCode]).toBeDefined();
      expect(BOLT_ERROR_CODE_FRIENDLY_MESSAGES[code as BoltErrorCode].length).toBeGreaterThan(0);
    }
  });
});
