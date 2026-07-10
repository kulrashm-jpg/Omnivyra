/**
 * REGRESSION — carousel permanent-failure incident (2026-07-10, campaign
 * b7d9e981): every production BOLT carousel failed with
 * "creator carousel generation could not produce a complete, minimum-viable
 * carousel from real content" (all-time success rate: ZERO).
 *
 * Root cause (reproduced live against the real model): the carousel prompt's
 * OUTPUT FORMAT example instructed a separate top-level `cta_slide` object,
 * while the completeness contract requires the CTA INSIDE `slides` (frame
 * count + role order). The model followed the example → N−1 inline slides →
 * count failure; when retry-forced inline, the example's cta_slide shape has
 * no `body_text` → body-less final slide → completeness failure AND the
 * reduced-deck fallback's bookend check failure → permanent error.
 *
 * Fixes locked here:
 *  1. normalizeCarouselBlueprintShape folds a legacy `cta_slide` into the
 *     deck using ONLY model-authored content (defense-in-depth).
 *  2. The prompt example now places the CTA inside `slides` with body_text
 *     (checked via the composed system prompt).
 */

import {
  normalizeCarouselBlueprintShape,
  carouselBlueprintIsComplete,
  isCarouselSlideComplete,
} from '../../services/executionEngines/creatorExecutionEnginePrep';
import { getCreatorSystemPrompt } from '../../prompts/creatorContentPromptsV1';

const slide = (n: number, role: string, headline: string, body: string) => ({
  slide_number: n,
  role,
  headline,
  body_text: body,
  visual_description: `visual for ${headline}`,
});

const TEMPLATE = {
  structure_schema: {
    frame_count: 6,
    frame_roles: ['hook', 'insight', 'insight', 'insight', 'proof', 'cta'],
  },
};

const fiveInlineSlides = () => [
  slide(1, 'hook', 'Stop guessing your reach', 'Most SMB teams cannot see which channels build awareness.'),
  slide(2, 'insight', 'Awareness compounds', 'Consistent thought leadership lifts branded search over quarters.'),
  slide(3, 'insight', 'Map your data', 'A data map connects content themes to pipeline signals.'),
  slide(4, 'insight', 'Pick two channels', 'Depth on two platforms beats thin presence on six.'),
  slide(5, 'proof', 'The numbers agree', 'Teams doing this report faster sales cycles within two quarters.'),
];

describe('normalizeCarouselBlueprintShape — the exact incident shapes', () => {
  it('attempt-1 shape: 5 inline slides + separate cta_slide → folded into a complete 6-slide deck', () => {
    const blueprint = {
      carousel_theme: 'awareness',
      total_slides: 6,
      slides: fiveInlineSlides(),
      cta_slide: {
        headline: 'Build your data map today',
        visual_description: 'brand-colored closing card',
        cta_text: 'Download the awareness data-map template and start this week',
      },
    };
    const normalized = normalizeCarouselBlueprintShape(blueprint);
    expect((normalized as any).cta_slide).toBeUndefined();
    const slides = (normalized as any).slides;
    expect(slides).toHaveLength(6);
    expect(slides[5].role).toBe('cta');
    expect(isCarouselSlideComplete(slides[5])).toBe(true); // cta_text became the body
    expect(carouselBlueprintIsComplete(normalized, TEMPLATE)).toBe(true);
  });

  it('attempt-2 shape: inline body-less CTA + cta_slide → body backfilled from cta_text', () => {
    const bodylessCta = { slide_number: 6, role: 'cta', headline: 'Start Your Journey Today!', body_text: '', visual_description: 'closing visual' };
    const blueprint = {
      slides: [...fiveInlineSlides(), bodylessCta],
      cta_slide: {
        headline: 'Start Your Journey Today!',
        cta_text: 'Get the free awareness data-map checklist now',
        visual_description: 'closing visual',
      },
    };
    const normalized = normalizeCarouselBlueprintShape(blueprint);
    const slides = (normalized as any).slides;
    expect(slides).toHaveLength(6); // merged, not appended
    expect(isCarouselSlideComplete(slides[5])).toBe(true);
    expect(carouselBlueprintIsComplete(normalized, TEMPLATE)).toBe(true);
  });

  it('no cta_slide → blueprint returned unchanged (idempotent)', () => {
    const blueprint = { slides: [...fiveInlineSlides(), slide(6, 'cta', 'Act now', 'Grab the template and map your channels today.')] };
    expect(normalizeCarouselBlueprintShape(blueprint)).toBe(blueprint);
  });

  it('an EMPTY cta_slide cannot fabricate content — deck stays incomplete', () => {
    const blueprint = { slides: fiveInlineSlides(), cta_slide: { headline: '', cta_text: '' } };
    const normalized = normalizeCarouselBlueprintShape(blueprint);
    expect(carouselBlueprintIsComplete(normalized, TEMPLATE)).toBe(false); // nothing invented
  });
});

describe('carousel prompt contract (the prompt-side fix)', () => {
  it('the OUTPUT FORMAT no longer instructs a separate cta_slide and requires body_text on the CTA slide', () => {
    const system = getCreatorSystemPrompt('carousel', { slide_count: 6, target_platforms: ['linkedin'] });
    expect(system).not.toContain('"cta_slide": {');
    expect(system).toContain('INCLUDING the final CTA slide');
    expect(system).toContain('"role": "cta"');
  });
});
