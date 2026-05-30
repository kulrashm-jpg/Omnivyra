/**
 * Strategy-Aware Rendering — distinctness regression suite.
 *
 * Pins the load-bearing invariants for the RenderStrategyRegistry:
 *
 *   1. Registry covers all 16 declared purpose-strategy ids.
 *   2. Modifier vectors (typography scales, margin scale, scrim
 *      intensity, logo scale, ctaMode, focalEmphasis, text-block
 *      position) are measurably distinct across competing strategies
 *      within the same contentType — Quote ≠ Product Showcase,
 *      Educational ≠ Promotional, Statistics ≠ Comparison, etc.
 *   3. `applyScale` clamps multipliers within safe bounds so a
 *      malformed strategy can't produce off-canvas sizes.
 *   4. Legacy callers (no purposeStrategyId, null, or unknown id)
 *      receive `null` from the resolver — the renderer treats null
 *      as a "no-op" gate, preserving byte-identical output for
 *      pre-phase assets (PHASE 10 regression safety).
 *   5. Every strategy carries a complete explainability envelope
 *      (typographyProfile + brandingProfile + densityProfile +
 *      ctaProfile + visualEmphasisProfile) so the renderer can emit
 *      a non-empty Applied Render Strategy explainer.
 *
 * Any failure here means a strategy has collapsed into a no-op or
 * its modifier vector has accidentally aligned with a competing
 * strategy.
 */

import {
  resolveRenderStrategy,
  listRenderStrategies,
  applyScale,
  type RenderStrategy,
  type RenderStrategyModifiers,
} from '../../services/creator/renderStrategyRegistry';

const FORCE_RESOLVE = (id: string): RenderStrategy => {
  const s = resolveRenderStrategy(id);
  if (!s) throw new Error(`render strategy not found: ${id}`);
  return s;
};

/** Build a quantitative-modifier vector for comparison. */
function modifierVector(m: RenderStrategyModifiers): string {
  return [
    m.headlineScale,
    m.hookScale,
    m.insightScale,
    m.supportScale,
    m.maxHeadlineLinesDelta,
    m.marginScale,
    m.textBlockTopRatio ?? 'null',
    m.scrimIntensityMultiplier,
    m.logoScaleMultiplier,
    m.logoOpacity,
    m.ctaMode,
    m.focalEmphasis,
  ].join('|');
}

describe('Registry coverage', () => {
  test('exposes all 16 declared render strategies', () => {
    expect(listRenderStrategies().length).toBe(16);
  });

  test('every strategy id matches a known purpose-strategy id format', () => {
    for (const s of listRenderStrategies()) {
      expect(s.id).toMatch(/^(image|carousel|infographic):[a-z0-9_-]+$/);
    }
  });

  test('every strategy exposes a complete explainability envelope', () => {
    for (const s of listRenderStrategies()) {
      expect(s.explainability.typographyProfile.length).toBeGreaterThan(10);
      expect(s.explainability.brandingProfile.length).toBeGreaterThan(10);
      expect(s.explainability.densityProfile.length).toBeGreaterThan(10);
      expect(s.explainability.ctaProfile.length).toBeGreaterThan(10);
      expect(s.explainability.visualEmphasisProfile.length).toBeGreaterThan(10);
    }
  });
});

describe('Resolver — legacy regression safety (PHASE 10)', () => {
  test('null id returns null', () => {
    expect(resolveRenderStrategy(null)).toBeNull();
  });
  test('undefined id returns null', () => {
    expect(resolveRenderStrategy(undefined)).toBeNull();
  });
  test('empty-string id returns null', () => {
    expect(resolveRenderStrategy('')).toBeNull();
    expect(resolveRenderStrategy('   ')).toBeNull();
  });
  test('unknown id returns null (renderer falls back to baseline preset)', () => {
    expect(resolveRenderStrategy('image:totally-unknown-purpose')).toBeNull();
  });
  test('whitespace is trimmed before lookup', () => {
    expect(resolveRenderStrategy('  image:promotional-image  ')).not.toBeNull();
  });
});

describe('applyScale — clamping safety', () => {
  test('multiplier 1.0 returns base unchanged', () => {
    expect(applyScale(100, 1.0)).toBe(100);
  });
  test('multiplier below minBound is clamped', () => {
    expect(applyScale(100, 0.1)).toBe(50); // default minBound 0.5
  });
  test('multiplier above maxBound is clamped', () => {
    expect(applyScale(100, 5.0)).toBe(175); // default maxBound 1.75
  });
  test('NaN multiplier returns base unchanged', () => {
    expect(applyScale(100, Number.NaN)).toBe(100);
  });
  test('custom bounds are honored', () => {
    expect(applyScale(100, 2.0, 0.5, 1.5)).toBe(150);
  });
});

describe('Image strategies are measurably distinct at render-output level', () => {
  const promo = FORCE_RESOLVE('image:promotional-image');
  const edu = FORCE_RESOLVE('image:educational-image');
  const quote = FORCE_RESOLVE('image:quote-image');
  const product = FORCE_RESOLVE('image:product-showcase-image');
  const brand = FORCE_RESOLVE('image:brand-focus-image');

  test('all 5 image strategy modifier vectors are unique', () => {
    const vectors = [promo, edu, quote, product, brand].map((s) => modifierVector(s.modifiers));
    expect(new Set(vectors).size).toBe(5);
  });

  test('Quote ≠ Product Showcase (distinct typography + cta + margin)', () => {
    expect(quote.modifiers.headlineScale).not.toBe(product.modifiers.headlineScale);
    expect(quote.modifiers.ctaMode).not.toBe(product.modifiers.ctaMode);
    expect(quote.modifiers.logoScaleMultiplier).not.toBe(product.modifiers.logoScaleMultiplier);
    expect(quote.modifiers.marginScale).not.toBe(product.modifiers.marginScale);
  });

  test('Educational ≠ Promotional (distinct headline + cta + scrim + margin)', () => {
    expect(edu.modifiers.headlineScale).not.toBe(promo.modifiers.headlineScale);
    expect(edu.modifiers.ctaMode).not.toBe(promo.modifiers.ctaMode);
    expect(edu.modifiers.scrimIntensityMultiplier).not.toBe(promo.modifiers.scrimIntensityMultiplier);
    expect(edu.modifiers.marginScale).not.toBe(promo.modifiers.marginScale);
  });

  test('Brand Focus ≠ Educational (distinct logo + branding + margin)', () => {
    expect(brand.modifiers.logoScaleMultiplier).not.toBe(edu.modifiers.logoScaleMultiplier);
    expect(brand.modifiers.marginScale).not.toBe(edu.modifiers.marginScale);
    // Brand-focus has LARGER logo, educational has SMALLER
    expect(brand.modifiers.logoScaleMultiplier).toBeGreaterThan(edu.modifiers.logoScaleMultiplier);
  });

  test('Promotional uses strong CTA, Quote suppresses CTA', () => {
    expect(promo.modifiers.ctaMode).toBe('strong');
    expect(quote.modifiers.ctaMode).toBe('absent');
  });

  test('Quote uses largest headline scale of the 5 image strategies', () => {
    const allScales = [promo, edu, quote, product, brand].map((s) => s.modifiers.headlineScale);
    expect(Math.max(...allScales)).toBe(quote.modifiers.headlineScale);
  });

  test('Brand Focus uses largest logo scale of the 5 image strategies', () => {
    const allScales = [promo, edu, quote, product, brand].map((s) => s.modifiers.logoScaleMultiplier);
    expect(Math.max(...allScales)).toBe(brand.modifiers.logoScaleMultiplier);
  });

  test('Product Showcase lowers the text block to bottom-third', () => {
    expect(product.modifiers.textBlockTopRatio).not.toBeNull();
    expect(product.modifiers.textBlockTopRatio!).toBeGreaterThan(0.5);
  });
});

describe('Carousel strategies are measurably distinct at render-output level', () => {
  const edu = FORCE_RESOLVE('carousel:educational-carousel');
  const fw = FORCE_RESOLVE('carousel:framework-carousel');
  const story = FORCE_RESOLVE('carousel:story-carousel');
  const product = FORCE_RESOLVE('carousel:product-showcase-carousel');
  const pres = FORCE_RESOLVE('carousel:presentation-carousel');

  test('all 5 carousel strategy modifier vectors are unique', () => {
    const vectors = [edu, fw, story, product, pres].map((s) => modifierVector(s.modifiers));
    expect(new Set(vectors).size).toBe(5);
  });

  test('Story ≠ Presentation Carousel (distinct headline + scrim + textBlockTop + cta)', () => {
    expect(story.modifiers.headlineScale).not.toBe(pres.modifiers.headlineScale);
    expect(story.modifiers.scrimIntensityMultiplier).not.toBe(pres.modifiers.scrimIntensityMultiplier);
    expect(story.modifiers.textBlockTopRatio).not.toBe(pres.modifiers.textBlockTopRatio);
    expect(story.modifiers.ctaMode).not.toBe(pres.modifiers.ctaMode);
  });

  test('Presentation uses the largest headline scale of carousel strategies (deck typography)', () => {
    const scales = [edu, fw, story, product, pres].map((s) => s.modifiers.headlineScale);
    expect(Math.max(...scales)).toBe(pres.modifiers.headlineScale);
  });

  test('Product Showcase Carousel uses strong CTA on close', () => {
    expect(product.modifiers.ctaMode).toBe('strong');
  });

  test('Story Carousel raises text block (cinematic upper-third framing)', () => {
    expect(story.modifiers.textBlockTopRatio).not.toBeNull();
    expect(story.modifiers.textBlockTopRatio!).toBeLessThan(0.5);
  });

  test('Framework Carousel maintains balanced defaults for parallel pillar layout', () => {
    expect(fw.modifiers.marginScale).toBe(1.0);
    expect(fw.modifiers.logoScaleMultiplier).toBe(1.0);
  });
});

describe('Infographic strategies are measurably distinct at render-output level', () => {
  const stats = FORCE_RESOLVE('infographic:stats');
  const process = FORCE_RESOLVE('infographic:process');
  const timeline = FORCE_RESOLVE('infographic:timeline');
  const comp = FORCE_RESOLVE('infographic:comparison');
  const fw = FORCE_RESOLVE('infographic:framework');
  const roadmap = FORCE_RESOLVE('infographic:roadmap');

  test('all 6 infographic strategy modifier vectors are unique', () => {
    const vectors = [stats, process, timeline, comp, fw, roadmap].map((s) => modifierVector(s.modifiers));
    expect(new Set(vectors).size).toBe(6);
  });

  test('Statistics ≠ Comparison (distinct headline + cta + margin)', () => {
    expect(stats.modifiers.headlineScale).not.toBe(comp.modifiers.headlineScale);
    expect(stats.modifiers.ctaMode).not.toBe(comp.modifiers.ctaMode);
    expect(stats.modifiers.marginScale).not.toBe(comp.modifiers.marginScale);
  });

  test('Statistics has the largest headline scale (metric numerals dominate)', () => {
    const scales = [stats, process, timeline, comp, fw, roadmap].map((s) => s.modifiers.headlineScale);
    expect(Math.max(...scales)).toBe(stats.modifiers.headlineScale);
  });

  test('Comparison uses the tightest margins (dense side-by-side columns)', () => {
    const margins = [stats, process, timeline, comp, fw, roadmap].map((s) => s.modifiers.marginScale);
    expect(Math.min(...margins)).toBe(comp.modifiers.marginScale);
  });

  test('Timeline uses larger headline scale than Process (chronology emphasis)', () => {
    expect(timeline.modifiers.headlineScale).toBeGreaterThan(process.modifiers.headlineScale);
  });

  test('Roadmap and Timeline differ in headline scale despite related architecture', () => {
    expect(roadmap.modifiers.headlineScale).not.toBe(timeline.modifiers.headlineScale);
  });
});

describe('Explainability envelopes reference their dimension', () => {
  test('Each strategy\'s typography profile references a typography-specific term', () => {
    for (const s of listRenderStrategies()) {
      const prof = s.explainability.typographyProfile.toLowerCase();
      expect(prof).toMatch(/headline|typography|numeral|eyebrow|scale|feature/);
    }
  });

  test('Each strategy\'s branding profile references the brand mark', () => {
    for (const s of listRenderStrategies()) {
      const prof = s.explainability.brandingProfile.toLowerCase();
      expect(prof).toMatch(/brand|logo|mark/);
    }
  });

  test('Each strategy\'s cta profile references its ctaMode behaviour', () => {
    for (const s of listRenderStrategies()) {
      const prof = s.explainability.ctaProfile.toLowerCase();
      expect(prof).toMatch(/cta|absent|subtle|standard|strong|action|close|pill|next/);
    }
  });
});

describe('Cross-cutting: distinctness contract from the implementation plan', () => {
  // The implementation report MUST be able to assert:
  // "Quote Image ≠ Product Showcase", "Educational ≠ Promotional",
  // "Brand Focus ≠ Educational", "Statistics ≠ Comparison",
  // "Story Carousel ≠ Presentation Carousel".
  // These tests pin those exact contracts at the renderer level.

  test('Quote Image ≠ Product Showcase Image — distinct render vectors', () => {
    const q = modifierVector(FORCE_RESOLVE('image:quote-image').modifiers);
    const p = modifierVector(FORCE_RESOLVE('image:product-showcase-image').modifiers);
    expect(q).not.toBe(p);
  });

  test('Educational ≠ Promotional Image — distinct render vectors', () => {
    const e = modifierVector(FORCE_RESOLVE('image:educational-image').modifiers);
    const p = modifierVector(FORCE_RESOLVE('image:promotional-image').modifiers);
    expect(e).not.toBe(p);
  });

  test('Brand Focus ≠ Educational Image — distinct render vectors', () => {
    const b = modifierVector(FORCE_RESOLVE('image:brand-focus-image').modifiers);
    const e = modifierVector(FORCE_RESOLVE('image:educational-image').modifiers);
    expect(b).not.toBe(e);
  });

  test('Statistics ≠ Comparison Infographic — distinct render vectors', () => {
    const s = modifierVector(FORCE_RESOLVE('infographic:stats').modifiers);
    const c = modifierVector(FORCE_RESOLVE('infographic:comparison').modifiers);
    expect(s).not.toBe(c);
  });

  test('Story Carousel ≠ Presentation Carousel — distinct render vectors', () => {
    const st = modifierVector(FORCE_RESOLVE('carousel:story-carousel').modifiers);
    const pr = modifierVector(FORCE_RESOLVE('carousel:presentation-carousel').modifiers);
    expect(st).not.toBe(pr);
  });
});
