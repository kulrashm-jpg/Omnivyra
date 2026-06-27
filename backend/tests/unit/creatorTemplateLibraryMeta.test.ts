import { SYSTEM_TEMPLATES, ALL_SYSTEM_TEMPLATES, getTemplateById, type CreatorTemplate } from '../../../lib/creator-templates';

const SAFE_MAX_FIELD_LEN = 260;

function allFields(t: CreatorTemplate) {
  const fd = t.formDefinition;
  return [...fd.fields, ...(fd.slides?.fields ?? []), ...(fd.sections?.fields ?? [])];
}

describe('System Template Library V1 — metadata + density integrity', () => {
  it('every text field stays within safe density bounds (passes visual validation by construction)', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) {
      for (const f of allFields(t)) {
        if (typeof f.maxLength === 'number') {
          expect(f.maxLength).toBeGreaterThan(0);
          expect(f.maxLength).toBeLessThanOrEqual(SAFE_MAX_FIELD_LEN);
        }
        expect(f.key.trim().length).toBeGreaterThan(0);
        expect(f.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every template carries search / filter / difficulty / use-case / aspect metadata', () => {
    for (const t of ALL_SYSTEM_TEMPLATES) {
      const m = t.metadata as Record<string, unknown>;
      expect(Array.isArray(m.keywords) && (m.keywords as string[]).length > 0).toBe(true);
      expect(typeof m.searchText).toBe('string');
      expect(['easy', 'intermediate', 'advanced']).toContain(m.difficulty);
      expect(Array.isArray(m.recommendedUseCases) && (m.recommendedUseCases as string[]).length > 0).toBe(true);
      expect(Array.isArray(m.aspectSupport) && (m.aspectSupport as string[]).length > 0).toBe(true);
    }
  });

  it('image text templates route to a text-capable lane; logo/no-text to supporting_image', () => {
    for (const t of SYSTEM_TEMPLATES.image) {
      const w = t.renderingContract.writerAssetType;
      expect(['banner', 'supporting_image']).toContain(w);
      if (t.renderingContract.attachmentMode === 'embedded_copy') expect(w).toBe('banner');
    }
  });
});

describe('System Template Library V1 — breadth coverage', () => {
  it('meets the production library minimums per family', () => {
    expect(SYSTEM_TEMPLATES.image.length).toBeGreaterThanOrEqual(26);
    expect(SYSTEM_TEMPLATES.carousel.length).toBeGreaterThanOrEqual(20);
    expect(SYSTEM_TEMPLATES.infographic.length).toBeGreaterThanOrEqual(20);
  });

  it('includes the headline requested templates across families', () => {
    const names = new Set(ALL_SYSTEM_TEMPLATES.map((t) => t.name));
    for (const n of ['Hero Announcement', 'Feature Highlight', 'Comparison', 'Milestone', 'Thank You', 'Tip Card', 'Minimal Brand Card', 'Premium Luxury', 'Corporate', 'Modern Tech', 'Clean Editorial']) {
      expect(names.has(n)).toBe(true);
    }
    for (const n of ['Problem → Solution', 'Listicle', 'Customer Journey', 'Product Walkthrough', 'Marketing Funnel', 'Thought Leadership']) {
      expect(names.has(n)).toBe(true);
    }
    for (const n of ['SWOT', 'Workflow', 'KPI Dashboard', 'Feature Comparison', 'Product Architecture', 'Business Model', 'Org Structure', 'Cycle']) {
      expect(names.has(n)).toBe(true);
    }
  });

  it('newly added templates resolve by id with the correct family', () => {
    expect(getTemplateById('sys-image-hero-announcement', 'image')?.name).toBe('Hero Announcement');
    expect(getTemplateById('sys-carousel-marketing-funnel', 'carousel')?.name).toBe('Marketing Funnel');
    expect(getTemplateById('sys-infographic-swot', 'infographic')?.name).toBe('SWOT');
    expect(getTemplateById('sys-infographic-swot', 'image')).toBeNull();
  });
});
