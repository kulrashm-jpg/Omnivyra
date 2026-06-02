/**
 * Regression: blueprint guard must NOT reject a valid text plan as
 * "zero activities" when the AI emits the common commit-plan shape —
 * empty `daily`, bare `content_type_mix` entries (no leading count),
 * and per-platform post counts in `platform_allocation`.
 *
 * Reproduces the exact production shape that produced repeated
 * raw_error_message="Blueprint declares zero activities across all weeks."
 * (run a25d9c6a-… and siblings), surfaced to the user as the misleading
 * "We couldn't save the campaign blueprint. Please try again."
 *
 * The week declares facebook:2 + linkedin:4 = 6 posts via
 * platform_allocation; the validator previously only counted
 * content_type_mix entries that started with a digit, summing to 0.
 */

import { validateBoltBlueprint, assertValidBoltBlueprint } from '../../../lib/shared/bolt/validateBoltBlueprint';
import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

function prodZeroActivityShape() {
  return {
    weeks: [{
      week: 1,
      daily: [],
      theme: 'Deepening understanding of Brand Awareness',
      funnel_stage: 'awareness',
      content_type_mix: ['poll', 'short_story'], // bare names, no leading count
      primary_objective: 'Build awareness',
      platform_allocation: { facebook: 2, linkedin: 4 }, // 6 posts declared here
    }],
  };
}

describe('Blueprint guard — activity-count extraction', () => {
  test('counts platform_allocation post counts (the canonical commit-plan signal)', () => {
    const r = validateBoltBlueprint(prodZeroActivityShape());
    expect(r.totals.activities).toBe(6);
    expect(r.errors.map((e) => e.code)).not.toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT);
  });

  test('assertValidBoltBlueprint does not throw on the prod zero-activity shape', () => {
    // CTA is warning-class and filtered out by assertValidBoltBlueprint, so a
    // plan with 6 activities + valid platforms/content types must not throw.
    expect(() => assertValidBoltBlueprint(prodZeroActivityShape())).not.toThrow();
  });

  test('counts bare content_type_mix entries as one activity each', () => {
    const r = validateBoltBlueprint({
      weeks: [{ week_number: 1, platform_allocation: { x: 1 }, content_type_mix: ['post', 'tweet', 'poll'] }],
    });
    // max(platform_allocation=1, content_type_mix bare=3) = 3
    expect(r.totals.activities).toBe(3);
  });

  test('still rejects a genuinely empty week (no activities anywhere)', () => {
    const r = validateBoltBlueprint({
      weeks: [{ week_number: 1, platform_allocation: { linkedin: 0 }, content_type_mix: [] }],
    });
    expect(r.errors.map((e) => e.code)).toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT);
  });
});
