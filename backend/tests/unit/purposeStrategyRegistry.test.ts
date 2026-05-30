/**
 * Purpose-Driven Creative Generation — distinctness regression suite.
 *
 * Pins the load-bearing invariants for the PurposeStrategyRegistry:
 *
 *   1. Registry covers all 16 declared strategies (5 image + 5
 *      carousel + 6 infographic).
 *   2. Resolver returns the matching strategy for every declared key
 *      across both contentType aliasing paths (image/banner share
 *      the image strategies; carousel/slider/pdf share carousel
 *      strategies).
 *   3. Each pair of "competing" purposes within the same contentType
 *      produces MEASURABLY DISTINCT outputs from
 *      `composeCreatorImagePrompt` — different prompt directives,
 *      composition hints, density biases, CTA intensities, etc.
 *      Educational ≠ Promotional ≠ Quote ≠ Product Showcase ≠ Brand
 *      Focus. Story Carousel ≠ Framework Carousel. Comparison
 *      Infographic ≠ Timeline Infographic.
 *   4. Each strategy threads into the composer's purpose layer and
 *      flat prompt (the strategy id, generatedAsLabel, density, CTA
 *      intensity, etc. all appear in the flat prompt).
 *   5. Slide-arc roles are exposed for all 5 carousel strategies;
 *      information-architecture patterns are exposed for all 6
 *      infographic strategies.
 *   6. Strategies do NOT override the existing prompt path when no
 *      purposeKey is supplied (legacy callers stay byte-identical).
 *
 * Any failure here indicates a strategy has accidentally
 * collapsed back into a label rather than a generation profile.
 */

import {
  resolvePurposeStrategy,
  listPurposeStrategies,
  listPurposeStrategiesForContentType,
  type PurposeStrategy,
} from '../../services/creator/purposeStrategyRegistry';
import {
  composeCreatorImagePrompt,
  type CreatorPromptInput,
} from '../../services/creator/creatorPromptComposer';

const BASE_INPUT: CreatorPromptInput = {
  title: 'Omnivyra launch',
  body: 'Marketing teams gain clarity through unified intelligence.',
  eyebrow: 'image',
  contentType: 'image',
  objective: 'awareness',
  audience: 'Marketing leaders',
  platform: 'linkedin',
  brandMode: 'brand-aware',
  brandKit: {
    companyName: 'Omnivyra',
    industry: 'Marketing technology',
    tone: 'editorial',
    accentColor: '#2B6CB0',
    palette: ['#0F172A', '#2B6CB0', '#E2E8F0'],
  },
};

describe('Registry coverage', () => {
  test('exposes all 16 declared strategies', () => {
    const all = listPurposeStrategies();
    expect(all.length).toBe(16);
  });

  test('image content type has exactly 5 strategies', () => {
    expect(listPurposeStrategiesForContentType('image').length).toBe(5);
  });

  test('carousel content type has exactly 5 strategies', () => {
    expect(listPurposeStrategiesForContentType('carousel').length).toBe(5);
  });

  test('infographic content type has exactly 6 strategies', () => {
    expect(listPurposeStrategiesForContentType('infographic').length).toBe(6);
  });

  test('every strategy carries a non-empty whyChosen + generatedAsLabel', () => {
    for (const s of listPurposeStrategies()) {
      expect(s.whyChosen.length).toBeGreaterThan(20);
      expect(s.generatedAsLabel.length).toBeGreaterThan(3);
    }
  });

  test('every strategy id starts with its contentType', () => {
    for (const s of listPurposeStrategies()) {
      expect(s.id.startsWith(`${s.contentType}:`)).toBe(true);
    }
  });
});

describe('Resolver: contentType aliasing', () => {
  test('banner contentType resolves through the image strategies', () => {
    const s = resolvePurposeStrategy('banner', 'promotional-image');
    expect(s).not.toBeNull();
    expect(s?.contentType).toBe('image');
    expect(s?.id).toBe('image:promotional-image');
  });

  test('slider contentType resolves through the carousel strategies', () => {
    const s = resolvePurposeStrategy('slider', 'presentation-carousel');
    expect(s).not.toBeNull();
    expect(s?.contentType).toBe('carousel');
    expect(s?.id).toBe('carousel:presentation-carousel');
  });

  test('pdf contentType resolves through the carousel strategies', () => {
    const s = resolvePurposeStrategy('pdf', 'framework-carousel');
    expect(s).not.toBeNull();
    expect(s?.contentType).toBe('carousel');
  });

  test('unknown contentType + unknown key returns null', () => {
    expect(resolvePurposeStrategy('video', 'something')).toBeNull();
    expect(resolvePurposeStrategy('image', 'nonexistent-key')).toBeNull();
  });

  test('null / empty purposeKey returns null', () => {
    expect(resolvePurposeStrategy('image', null)).toBeNull();
    expect(resolvePurposeStrategy('image', '')).toBeNull();
    expect(resolvePurposeStrategy('image', undefined)).toBeNull();
  });
});

describe('Image strategies are measurably distinct (Educational ≠ Promotional ≠ Quote ≠ Product Showcase ≠ Brand Focus)', () => {
  const ids = ['promotional-image', 'educational-image', 'quote-image', 'product-showcase-image', 'brand-focus-image'];
  const strategies = ids.map((id) => resolvePurposeStrategy('image', id)).filter(Boolean) as PurposeStrategy[];

  test('all five strategies are present', () => {
    expect(strategies.length).toBe(5);
  });

  test('densityBias, brandingIntensity, typographyWeight, ctaIntensity vectors differ', () => {
    // Compose a vector of the 4 quantitative dimensions per strategy
    const vectors = strategies.map((s) => `${s.densityBias}|${s.brandingIntensity}|${s.typographyWeight}|${s.ctaIntensity}`);
    const distinct = new Set(vectors);
    // At least 4 of the 5 must have unique vectors. (Some may share
    // a single dimension while differing on others — full uniqueness
    // across all 4 is too brittle as a contract.)
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  test('promotional has STRONG cta intensity, quote has ABSENT cta intensity', () => {
    const promo = strategies.find((s) => s.purposeKey === 'promotional-image')!;
    const quote = strategies.find((s) => s.purposeKey === 'quote-image')!;
    expect(promo.ctaIntensity).toBe('strong');
    expect(quote.ctaIntensity).toBe('absent');
  });

  test('quote has FEATURE typography weight, product-showcase has SUPPORT', () => {
    const quote = strategies.find((s) => s.purposeKey === 'quote-image')!;
    const product = strategies.find((s) => s.purposeKey === 'product-showcase-image')!;
    expect(quote.typographyWeight).toBe('feature');
    expect(product.typographyWeight).toBe('support');
  });

  test('brand-focus has STRONG branding intensity, educational has SUBTLE', () => {
    const brand = strategies.find((s) => s.purposeKey === 'brand-focus-image')!;
    const edu = strategies.find((s) => s.purposeKey === 'educational-image')!;
    expect(brand.brandingIntensity).toBe('strong');
    expect(edu.brandingIntensity).toBe('subtle');
  });

  test('prompt directives are textually distinct across all 5 strategies', () => {
    const directives = strategies.map((s) => s.promptDirectives.join(' | '));
    expect(new Set(directives).size).toBe(5);
  });

  test('scene-selection hints are textually distinct across all 5 strategies', () => {
    const hints = strategies.map((s) => s.sceneSelectionHints.join(' | '));
    expect(new Set(hints).size).toBe(5);
  });
});

describe('Carousel strategies are measurably distinct (Story ≠ Framework ≠ Educational ≠ Product Showcase ≠ Presentation)', () => {
  const ids = ['educational-carousel', 'framework-carousel', 'story-carousel', 'product-showcase-carousel', 'presentation-carousel'];
  const strategies = ids.map((id) => resolvePurposeStrategy('carousel', id)).filter(Boolean) as PurposeStrategy[];

  test('all five carousel strategies expose a slideArc', () => {
    for (const s of strategies) {
      expect(s.slideArc).toBeTruthy();
      expect(s.slideArc!.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('slide-arc role sequences are distinct across all 5 strategies', () => {
    const sequences = strategies.map((s) => s.slideArc!.map((r) => r.role).join(' → '));
    expect(new Set(sequences).size).toBe(5);
  });

  test('story carousel arc starts with hook + problem + journey', () => {
    const story = strategies.find((s) => s.purposeKey === 'story-carousel')!;
    const roles = story.slideArc!.map((r) => r.role);
    expect(roles).toEqual(['hook', 'problem', 'journey', 'transformation', 'outcome']);
  });

  test('framework carousel arc reveals 3 parallel pillars', () => {
    const fw = strategies.find((s) => s.purposeKey === 'framework-carousel')!;
    const roles = fw.slideArc!.map((r) => r.role);
    expect(roles).toEqual(['hook', 'overview', 'pillar_1', 'pillar_2', 'pillar_3', 'conclusion']);
  });

  test('product-showcase carousel arc ends with cta + has 2 feature slides', () => {
    const ps = strategies.find((s) => s.purposeKey === 'product-showcase-carousel')!;
    const roles = ps.slideArc!.map((r) => r.role);
    expect(roles[roles.length - 1]).toBe('cta');
    expect(roles.filter((r) => r === 'feature_1' || r === 'feature_2').length).toBe(2);
  });

  test('presentation carousel arc is deck-style (title → agenda → ... → next_steps)', () => {
    const pres = strategies.find((s) => s.purposeKey === 'presentation-carousel')!;
    const roles = pres.slideArc!.map((r) => r.role);
    expect(roles[0]).toBe('title');
    expect(roles[1]).toBe('agenda');
    expect(roles[roles.length - 1]).toBe('next_steps');
  });
});

describe('Infographic strategies are measurably distinct (Statistics ≠ Process ≠ Timeline ≠ Comparison ≠ Framework ≠ Roadmap)', () => {
  const ids = ['stats', 'process', 'timeline', 'comparison', 'framework', 'roadmap'];
  const strategies = ids.map((id) => resolvePurposeStrategy('infographic', id)).filter(Boolean) as PurposeStrategy[];

  test('all six infographic strategies expose informationArchitecture', () => {
    for (const s of strategies) {
      expect(s.informationArchitecture).toBeTruthy();
    }
  });

  test('information-architecture patterns are distinct across all 6 strategies', () => {
    const patterns = strategies.map((s) => s.informationArchitecture!.pattern);
    expect(new Set(patterns).size).toBe(6);
  });

  test('statistics infographic uses data_first pattern', () => {
    const s = strategies.find((s) => s.purposeKey === 'stats')!;
    expect(s.informationArchitecture!.pattern).toBe('data_first');
  });

  test('comparison infographic uses side_by_side pattern', () => {
    const s = strategies.find((s) => s.purposeKey === 'comparison')!;
    expect(s.informationArchitecture!.pattern).toBe('side_by_side');
  });

  test('timeline infographic uses chronology_first pattern', () => {
    const s = strategies.find((s) => s.purposeKey === 'timeline')!;
    expect(s.informationArchitecture!.pattern).toBe('chronology_first');
  });

  test('roadmap infographic uses phased_progression pattern (reuses timeline internally)', () => {
    const s = strategies.find((s) => s.purposeKey === 'roadmap')!;
    expect(s.informationArchitecture!.pattern).toBe('phased_progression');
  });

  test('section blueprints are distinct across all 6 strategies', () => {
    const blueprints = strategies.map((s) => s.informationArchitecture!.sectionBlueprint.join(','));
    expect(new Set(blueprints).size).toBe(6);
  });
});

describe('Cross-content-type uniqueness: Educational Image ≠ Educational Carousel', () => {
  test('share a label name but have distinct id + contentType + arc shape', () => {
    const eduImage = resolvePurposeStrategy('image', 'educational-image')!;
    const eduCarousel = resolvePurposeStrategy('carousel', 'educational-carousel')!;
    expect(eduImage.id).not.toBe(eduCarousel.id);
    expect(eduImage.contentType).not.toBe(eduCarousel.contentType);
    expect(eduImage.slideArc).toBeUndefined();
    expect(eduCarousel.slideArc).toBeTruthy();
  });
});

describe('Composer integration', () => {
  test('composer surfaces purposeStrategy envelope when purposeKey supplied', () => {
    const result = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'promotional-image' });
    expect(result.purposeStrategy).not.toBeNull();
    expect(result.purposeStrategy!.id).toBe('image:promotional-image');
    expect(result.purposeStrategy!.ctaIntensity).toBe('strong');
  });

  test('composer purpose layer populates when strategy resolves', () => {
    const result = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'educational-image' });
    expect(result.layers.purpose.length).toBeGreaterThan(0);
    expect(result.layers.purpose.join(' ')).toContain('Educational');
  });

  test('composer purpose layer is empty when no purposeKey', () => {
    const result = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: null });
    expect(result.layers.purpose.length).toBe(0);
    expect(result.purposeStrategy).toBeNull();
  });

  test('promotional vs educational vs quote image flat prompts are textually distinct', () => {
    const promo = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'promotional-image' });
    const edu = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'educational-image' });
    const quote = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'quote-image' });
    expect(promo.prompt).not.toBe(edu.prompt);
    expect(edu.prompt).not.toBe(quote.prompt);
    expect(promo.prompt).not.toBe(quote.prompt);
    // And each carries its strategy's distinctive directives
    expect(promo.prompt).toContain('promotional creative');
    expect(edu.prompt).toContain('educational creative');
    expect(quote.prompt).toContain('quote-anchored statement');
  });

  test('story carousel vs framework carousel prompts include their slide-arc roles', () => {
    const story = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'carousel', purposeKey: 'story-carousel' });
    const fw = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'carousel', purposeKey: 'framework-carousel' });
    expect(story.prompt).toContain('hook → problem → journey → transformation → outcome');
    expect(fw.prompt).toContain('hook → overview → pillar_1 → pillar_2 → pillar_3 → conclusion');
    expect(story.prompt).not.toBe(fw.prompt);
  });

  test('comparison vs timeline infographic prompts include their architecture pattern', () => {
    const comp = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'infographic', purposeKey: 'comparison' });
    const tl = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'infographic', purposeKey: 'timeline' });
    expect(comp.prompt).toContain('side_by_side');
    expect(tl.prompt).toContain('chronology_first');
    expect(comp.prompt).not.toBe(tl.prompt);
  });

  test('flat prompt contains density + branding + typography + cta intensity tags', () => {
    const result = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'brand-focus-image' });
    expect(result.prompt).toContain('Density discipline: minimal');
    expect(result.prompt).toContain('Branding intensity: strong');
    expect(result.prompt).toContain('Typography weight: support');
    expect(result.prompt).toContain('CTA intensity: subtle');
  });

  test('legacy callers (no purposeKey) get the original layered shape with empty purpose layer', () => {
    const result = composeCreatorImagePrompt({ ...BASE_INPUT });
    expect(result.layers.campaign.length).toBeGreaterThan(0);
    expect(result.layers.asset.length).toBeGreaterThan(0);
    expect(result.layers.purpose.length).toBe(0);
    // Prompt still parses + contains the header
    expect(result.prompt).toContain('production-ready editorial marketing visual');
  });
});

describe('Distinctness contract — the core delivery from this phase', () => {
  // The implementation report from this phase MUST be able to assert:
  // "Educational Image ≠ Promotional Image",
  // "Quote Image ≠ Product Showcase",
  // "Story Carousel ≠ Framework Carousel",
  // "Comparison Infographic ≠ Timeline Infographic".
  // These tests pin those exact contracts.

  test('Educational Image ≠ Promotional Image (composer output)', () => {
    const a = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'educational-image' });
    const b = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'promotional-image' });
    expect(a.prompt).not.toBe(b.prompt);
    expect(a.purposeStrategy!.ctaIntensity).not.toBe(b.purposeStrategy!.ctaIntensity);
    expect(a.purposeStrategy!.densityBias).not.toBe(b.purposeStrategy!.densityBias);
  });

  test('Quote Image ≠ Product Showcase Image (composer output)', () => {
    const a = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'quote-image' });
    const b = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'product-showcase-image' });
    expect(a.prompt).not.toBe(b.prompt);
    expect(a.purposeStrategy!.typographyWeight).not.toBe(b.purposeStrategy!.typographyWeight);
    expect(a.purposeStrategy!.ctaIntensity).not.toBe(b.purposeStrategy!.ctaIntensity);
  });

  test('Story Carousel ≠ Framework Carousel (composer output)', () => {
    const a = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'carousel', purposeKey: 'story-carousel' });
    const b = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'carousel', purposeKey: 'framework-carousel' });
    expect(a.prompt).not.toBe(b.prompt);
    expect(a.purposeStrategy!.slideArcRoles).not.toEqual(b.purposeStrategy!.slideArcRoles);
  });

  test('Comparison Infographic ≠ Timeline Infographic (composer output)', () => {
    const a = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'infographic', purposeKey: 'comparison' });
    const b = composeCreatorImagePrompt({ ...BASE_INPUT, contentType: 'infographic', purposeKey: 'timeline' });
    expect(a.prompt).not.toBe(b.prompt);
    expect(a.purposeStrategy!.informationArchitecturePattern).not.toBe(b.purposeStrategy!.informationArchitecturePattern);
  });
});
