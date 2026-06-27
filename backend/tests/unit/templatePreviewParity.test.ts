import {
  listTemplatesForFamily, resolveTemplate, getTemplateById,
  IMAGE_VARIANTS, CAROUSEL_VARIANTS, INFOGRAPHIC_VARIANTS, variantKeyForTemplate,
} from '../../../lib/creator-templates';

const FAMILIES = ['image', 'carousel', 'infographic'] as const;

describe('TEMPLATE-017 preview/render parity (single canonical source)', () => {
  it('every template resolves a style for its family (no missing previews)', () => {
    for (const fam of FAMILIES) {
      const tpls = listTemplatesForFamily(fam);
      expect(tpls.length).toBeGreaterThan(0);
      for (const t of tpls) {
        const rt = resolveTemplate(t.id, { family: fam });
        expect(rt.matched).toBe(true);
        const style = fam === 'image' ? rt.imageStyle : fam === 'carousel' ? rt.carouselStyle : rt.infographicStyle;
        expect(style).toBeTruthy(); // preview has a canonical style to render from
      }
    }
  });

  it('the preview style IS the exact variant the renderer consumes (same source)', () => {
    // The gallery preview calls resolveTemplate(id) — the SAME call the renderer
    // makes via templateIdForRender → resolveTemplate. Prove they return the
    // assigned variant object, so there is no second preview system / no drift.
    for (const fam of FAMILIES) {
      for (const t of listTemplatesForFamily(fam)) {
        const key = variantKeyForTemplate(t.id, fam);
        const rt = resolveTemplate(t.id, { family: fam });
        if (fam === 'image') expect(rt.imageStyle).toBe((IMAGE_VARIANTS as any)[key]);
        else if (fam === 'carousel') expect(rt.carouselStyle).toBe((CAROUSEL_VARIANTS as any)[key]);
        else expect(rt.infographicStyle).toBe((INFOGRAPHIC_VARIANTS as any)[key]);
        // identical to the registry template's own style field (renderer path)
        const onTemplate = (getTemplateById(t.id) as any)[`${fam === 'infographic' ? 'infographic' : fam}Style`];
        expect(onTemplate).toBe(fam === 'image' ? rt.imageStyle : fam === 'carousel' ? rt.carouselStyle : rt.infographicStyle);
      }
    }
  });

  it('every style variant is visually represented (distinct variants → distinct style objects)', () => {
    for (const fam of FAMILIES) {
      const tpls = listTemplatesForFamily(fam);
      const keyToStyle = new Map<string, unknown>();
      for (const t of tpls) {
        const key = variantKeyForTemplate(t.id, fam);
        const rt = resolveTemplate(t.id, { family: fam });
        const style = fam === 'image' ? rt.imageStyle : fam === 'carousel' ? rt.carouselStyle : rt.infographicStyle;
        if (keyToStyle.has(key)) expect(keyToStyle.get(key)).toBe(style); // same key → same object
        else keyToStyle.set(key, style);
      }
      // distinct variant keys map to distinct style objects
      const objs = Array.from(keyToStyle.values());
      expect(new Set(objs).size).toBe(objs.length);
    }
  });
});
