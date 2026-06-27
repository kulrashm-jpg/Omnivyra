import {
  SYSTEM_TEMPLATES,
  ALL_SYSTEM_TEMPLATES,
  listTemplatesForFamily,
  listCategoriesForFamily,
  getTemplateById,
  familyForCreatorType,
  resolveTemplateCreatorCardPatch,
} from '../../../lib/creator-templates';
import {
  initTemplateValues,
  setSlideCount,
  addSection,
  removeSection,
  missingRequiredFields,
  projectImageOverlayText,
  projectCarouselSlides,
  projectInfographicSections,
} from '../../../lib/creator-templates/values';

describe('Creator Template Foundation — registry', () => {
  it('exposes three independent families with no cross-family sharing', () => {
    const ids = new Set<string>();
    for (const family of ['image', 'carousel', 'infographic'] as const) {
      const list = listTemplatesForFamily(family);
      expect(list.length).toBeGreaterThan(0);
      for (const t of list) {
        expect(t.assetFamily).toBe(family);
        expect(t.status).toBe('published');
        expect(t.ownership).toBe('system');
        expect(t.renderingContract.family).toBe(family);
        // No id collisions across families.
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      }
    }
    expect(ALL_SYSTEM_TEMPLATES.length).toBe(ids.size);
  });

  it('lists categories per family', () => {
    expect(listCategoriesForFamily('image').map((c) => c.key)).toEqual(
      expect.arrayContaining(['Promotional', 'Quote', 'Brand']),
    );
    expect(listCategoriesForFamily('infographic').map((c) => c.key)).toEqual(
      expect.arrayContaining(['Data', 'Sequence', 'Chronology', 'Comparison']),
    );
  });

  it('maps creator types onto families (incl. consolidation aliases)', () => {
    expect(familyForCreatorType('image')).toBe('image');
    expect(familyForCreatorType('banner')).toBe('image');
    expect(familyForCreatorType('carousel')).toBe('carousel');
    expect(familyForCreatorType('slider')).toBe('carousel');
    expect(familyForCreatorType('infographic')).toBe('infographic');
    expect(familyForCreatorType('post')).toBeNull();
    expect(familyForCreatorType('video')).toBeNull();
  });

  it('resolves templates by id and enforces family match', () => {
    expect(getTemplateById('sys-image-quote-author', 'image')?.name).toBe('Quote + Author');
    expect(getTemplateById('sys-image-quote-author', 'carousel')).toBeNull();
    expect(getTemplateById('does-not-exist')).toBeNull();
  });
});

describe('Creator Template Foundation — rendering contract projection', () => {
  it('projects an image template onto EXISTING creator_card inputs', () => {
    const quote = getTemplateById('sys-image-quote-author')!;
    const patch = resolveTemplateCreatorCardPatch(quote);
    expect(patch.template_id).toBe('sys-image-quote-author');
    expect(patch.subtype).toBe('quote-image');
    expect(patch.attachment_mode).toBe('embedded_copy');
    expect(patch.purpose_key).toBe('quote-image');
  });

  it('logo-only template requests a clean supporting_visual (no embedded copy)', () => {
    const logo = getTemplateById('sys-image-logo-only')!;
    const patch = resolveTemplateCreatorCardPatch(logo);
    expect(patch.attachment_mode).toBe('supporting_visual');
    // No purpose/subtype forced for the clean visual.
    expect(patch.subtype).toBeUndefined();
  });

  it('projects a carousel template with a default frame/slide count', () => {
    const carousel = getTemplateById('sys-carousel-storytelling-7')!;
    const patch = resolveTemplateCreatorCardPatch(carousel);
    expect(patch.slide_count).toBe(7);
    expect(patch.purpose_key).toBe('story-carousel');
  });

  it('projects an infographic template onto the existing infographic_layout', () => {
    const stats = getTemplateById('sys-infographic-statistics')!;
    const patch = resolveTemplateCreatorCardPatch(stats);
    expect(patch.infographic_layout).toBe('stats');
  });
});

describe('Creator Template Foundation — form values', () => {
  it('initialises image text values and projects onto overlay_text', () => {
    const tpl = getTemplateById('sys-image-headline-sub-cta')!;
    let values = initTemplateValues(tpl);
    values = { ...values, fields: { headline: 'Automate it', subheadline: 'Save 8 hrs', cta: 'Start' } };
    const overlay = projectImageOverlayText(tpl, values);
    expect(overlay.headline).toBe('Automate it');
    expect(overlay.supportingText).toBe('Save 8 hrs');
    expect(overlay.cta).toBe('Start');
  });

  it('maps quote/author onto the overlay headline + keyInsight', () => {
    const tpl = getTemplateById('sys-image-quote-author')!;
    const values = { fields: { quote: 'Keep it simple', author: '— Jane' } };
    const overlay = projectImageOverlayText(tpl, values as any);
    expect(overlay.headline).toBe('Keep it simple');
    expect(overlay.keyInsight).toBe('— Jane');
  });

  it('resizes carousel slides deterministically and projects them', () => {
    const tpl = getTemplateById('sys-carousel-educational-5')!;
    let values = initTemplateValues(tpl);
    expect(values.slides?.length).toBe(5);
    values = setSlideCount(tpl, values, 7);
    expect(values.slideCount).toBe(7);
    expect(values.slides?.length).toBe(7);
    values.slides![0].title = 'Hook';
    const projected = projectCarouselSlides(values);
    expect(projected.length).toBe(7);
    expect(projected[0]).toMatchObject({ slide_number: 1, title: 'Hook' });
  });

  it('enforces section min/max and projects infographic sections', () => {
    const tpl = getTemplateById('sys-infographic-statistics')!;
    let values = initTemplateValues(tpl);
    expect(values.sections?.length).toBe(2); // min
    // Cannot drop below min.
    values = removeSection(tpl, values, 0);
    expect(values.sections?.length).toBe(2);
    // Can add up to max (6).
    for (let i = 0; i < 10; i++) values = addSection(tpl, values);
    expect(values.sections?.length).toBe(6);
    values.sections![0].metric = '92%';
    values.sections![0].description = 'faster';
    const projected = projectInfographicSections(values);
    expect(projected[0]).toEqual({ metric: '92%', description: 'faster' });
  });

  it('reports missing required fields', () => {
    const tpl = getTemplateById('sys-image-headline')!;
    const values = initTemplateValues(tpl);
    expect(missingRequiredFields(tpl, values)).toContain('Headline / Image Text');
    values.fields.headline = 'Done';
    expect(missingRequiredFields(tpl, values)).toHaveLength(0);
  });
});
