/**
 * Carousel template fidelity — each carousel template renders its OWN arc (from
 * preview.sample.slides) instead of the shared 3 purpose arcs. resolveCarouselTemplateArc
 * slugifies the template's sample slides into distinct role keys; fitSlideArcToCount then
 * sizes that arc to the actual slide count.
 */
import { resolveCarouselTemplateArc } from '../../services/creatorAssetRenderer';
import { fitSlideArcToCount } from '../../services/creator/purposeStrategyRegistry';

describe('resolveCarouselTemplateArc — per-template carousel arc', () => {
  it('slugifies Before/After template slides into distinct roles', () => {
    const arc = resolveCarouselTemplateArc({ template_id: 'sys-carousel-before-after' });
    expect(arc).toEqual(['before', 'pain', 'shift', 'after', 'how_to_start']);
  });

  it('distinguishes templates that share a purposeKey (Before/After vs Mistakes)', () => {
    const beforeAfter = resolveCarouselTemplateArc({ template_id: 'sys-carousel-before-after' });
    const mistakes = resolveCarouselTemplateArc({ template_id: 'sys-carousel-mistakes' });
    expect(beforeAfter).not.toEqual(mistakes); // same 3-behaviour collapse is broken
    expect(mistakes && mistakes[0]).toBe('intro');
  });

  it('returns null for non-carousel / unknown templates (falls back to purpose arc)', () => {
    expect(resolveCarouselTemplateArc({ template_id: 'sys-image-statistic' })).toBeNull();
    expect(resolveCarouselTemplateArc({ template_id: 'does-not-exist' })).toBeNull();
    expect(resolveCarouselTemplateArc({})).toBeNull();
  });

  it('template arc is count-corrected by fitSlideArcToCount (distinct roles, no filler)', () => {
    const arc = resolveCarouselTemplateArc({ template_id: 'sys-carousel-before-after' })!;
    const fitted = fitSlideArcToCount(arc, 10); // template default is 5; user picked 10
    expect(fitted).toHaveLength(10);
    expect(new Set(fitted).size).toBe(10); // all distinct → no duplicate/filler slides
    expect(fitted[0]).toBe('before'); // opens on the template's first beat
    expect(fitted[fitted.length - 1]).toBe('how_to_start'); // closes on its last beat
  });
});
