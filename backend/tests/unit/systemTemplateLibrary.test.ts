import { ALL_SYSTEM_TEMPLATES, SYSTEM_TEMPLATES, listTemplatesForFamily, getTemplateById, resolveTemplate, type CreatorTemplate } from '../../../lib/creator-templates';

describe('TEMPLATE-012 production library', () => {
  it('has unique template ids', () => {
    const ids = ALL_SYSTEM_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every template defines the required fields + valid contract', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) {
      expect(t.id && t.name && t.category && t.description).toBeTruthy();
      expect(['image', 'carousel', 'infographic']).toContain(t.assetFamily);
      expect(t.preview).toBeTruthy();
      expect(t.renderingContract.family).toBe(t.assetFamily);
      expect(t.formDefinition).toBeTruthy();
      expect(t.version).toBe(1); expect(t.status).toBe('published'); expect(t.ownership).toBe('system');
      // resolver round-trips
      expect(getTemplateById(t.id)).toBe(t);
      const r = resolveTemplate(t.id);
      expect(r.matched).toBe(true);
      expect(r.family).toBe(t.assetFamily);
      if (t.assetFamily === 'infographic') expect(r.infographicStyle).toBeTruthy();
      if (t.assetFamily === 'image') expect(r.imageStyle).toBeTruthy();
      if (t.assetFamily === 'carousel') expect(r.carouselStyle).toBeTruthy();
    }
  });
  it('infographic layouts are valid renderer layouts', () => {
    const VALID = ['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline'];
    for (const t of SYSTEM_TEMPLATES.infographic) expect(VALID).toContain(t.renderingContract.infographicLayout);
  });
  it('family filtering returns only that family', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as const) {
      for (const t of listTemplatesForFamily(fam)) expect(t.assetFamily).toBe(fam);
    }
  });
  it('counts', () => {
    const by = (f: CreatorTemplate['assetFamily']) => listTemplatesForFamily(f).length;
    const banners = SYSTEM_TEMPLATES.image.filter((t) => t.category === 'Banner').length;
    // eslint-disable-next-line no-console
    console.log('COUNTS ' + JSON.stringify({ total: ALL_SYSTEM_TEMPLATES.length, image: by('image'), banners, carousel: by('carousel'), infographic: by('infographic') }));
    expect(ALL_SYSTEM_TEMPLATES.length).toBeGreaterThanOrEqual(40);
  });
});
