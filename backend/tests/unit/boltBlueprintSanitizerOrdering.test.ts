/**
 * Regression: blueprint guard must run against the SANITIZED plan.
 *
 * The text-mode commit path calls sanitizeBoltPlanForTextOnly inside
 * runCommitPlan, which strips/converts non-BOLT-text content types
 * (blog, video, reel, carousel, …) to BOLT-text equivalents. The guard
 * was previously running against the unsanitised plan and rejecting
 * `blog` even though the sanitiser would have turned it into `post`,
 * producing a BLUEPRINT_INVALID_CONTENT_TYPE → BLUEPRINT_SAVE_FAILED
 * surfaced as the generic "We couldn't save the campaign blueprint"
 * friendly message.
 *
 * This test reproduces the exact failing shape from production
 * (raw_error_message="Blueprint uses unsupported content types: blog.")
 * and verifies the post-sanitiser plan validates cleanly.
 */

import { validateBoltBlueprint, assertValidBoltBlueprint } from '../../../lib/shared/bolt/validateBoltBlueprint';
import { sanitizeBoltPlanForTextOnly } from '../../utils/boltTextContentConfig';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

function rawAiPlanWithBlog() {
  return {
    weeks: [{
      week_number: 1,
      platform_allocation: { linkedin: 3, x: 2 },
      content_type_mix: ['3 blog', '2 post'], // <- blog is what the AI emitted in prod
      cta: 'visit site',
    }],
  };
}

describe('Blueprint guard pre-sanitiser ordering', () => {
  test('REPRODUCTION: validator rejects raw blog content type', () => {
    const raw = rawAiPlanWithBlog();
    const r = validateBoltBlueprint(raw);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE);
  });

  test('FIX: validator accepts the same plan after sanitisation', () => {
    const raw = rawAiPlanWithBlog();
    const sanitized = { weeks: sanitizeBoltPlanForTextOnly(raw.weeks) };
    const r = validateBoltBlueprint(sanitized);
    expect(r.errors.map((e) => e.code)).not.toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE);
  });

  test('FIX: assertValidBoltBlueprint on sanitised plan does not throw for blog→post conversion', () => {
    const raw = rawAiPlanWithBlog();
    const sanitized = { weeks: sanitizeBoltPlanForTextOnly(raw.weeks) };
    // We only assert the BLUEPRINT_INVALID_CONTENT_TYPE case is fixed.
    // assertValidBoltBlueprint may still throw on unrelated structural
    // issues (CTA missing, zero activities); this test verifies the
    // blog-rejection regression specifically is gone.
    try {
      assertValidBoltBlueprint(sanitized);
    } catch (e) {
      expect((e as BoltError).code).not.toBe(BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE);
    }
  });

  test('media-mode plans (creator/combined) are NOT sanitised — validator must accept their content types', () => {
    // Creator-format plans skip sanitization in runCommitPlan; the
    // validator already accepts creator formats via the creator registry.
    const creatorPlan = {
      weeks: [{
        week_number: 1,
        platform_allocation: { instagram: 2 },
        content_type_mix: ['2 carousel'],
        cta: 'shop now',
      }],
    };
    const r = validateBoltBlueprint(creatorPlan);
    expect(r.errors.map((e) => e.code)).not.toContain(BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE);
  });
});
