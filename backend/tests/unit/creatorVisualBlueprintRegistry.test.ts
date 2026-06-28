import {
  VISUAL_BLUEPRINTS, getBlueprint, listBlueprints, listBlueprintsByCategory,
  blueprintCount, BLUEPRINT_CATEGORY_LABELS, type BlueprintCategory,
} from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';
import { VISUAL_STYLES } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';

const CATEGORIES = Object.keys(BLUEPRINT_CATEGORY_LABELS) as BlueprintCategory[];
const REQUIRED = ['corporate-portrait', 'food', 'technology', 'healthcare', 'manga', 'pixel-art', 'watercolor', 'comic', 'anime', 'product-3d', 'character-3d', 'editorial', 'luxury', 'dark', 'brutalist', 'before-after', 'comparison', 'testimonial', 'statistic', 'timeline', 'checklist', 'faq', 'hero-banner', 'dashboard', 'mobile-app', 'saas', 'analytics', 'ecommerce'];

describe('CREATOR-054 — Visual Blueprint registry', () => {
  it('STEP 2/3 — blueprints across every category, unique ids, all fields populated', () => {
    const counts = blueprintCount();
    expect(counts.total).toBeGreaterThanOrEqual(70);
    for (const c of CATEGORIES) expect(counts.byCategory[c]).toBeGreaterThan(0); // every category non-empty
    expect(new Set(VISUAL_BLUEPRINTS.map((b) => b.id)).size).toBe(VISUAL_BLUEPRINTS.length); // no duplicate blueprints
    for (const id of REQUIRED) expect(getBlueprint(id)).not.toBeNull();
    for (const b of VISUAL_BLUEPRINTS) {
      expect(b.title.length).toBeGreaterThan(1);
      expect(b.description.length).toBeGreaterThan(3);
      expect(CATEGORIES).toContain(b.visualCategory);
      expect(b.stylePrompt.length).toBeGreaterThan(3);
      expect(b.imagePrompt.length).toBeGreaterThan(3);
      expect(b.supportedFamilies.length).toBeGreaterThan(0);
      expect(b.colorRules.primary).toMatch(/^#/);
      expect(['high', 'soft']).toContain(b.colorRules.contrast);
      expect(['regular', 'medium', 'bold']).toContain(b.typographyRules.weight);
      expect(['photo', 'vector', 'hand', '3d', 'graphic', 'mockup']).toContain(b.illustrationRules.kind);
      // No runtime content fields (enforced by the type — assert no stray keys leaked in).
      expect(Object.prototype.hasOwnProperty.call(b, 'sample')).toBe(false);
    }
  });

  it('STEP 5 — every 051 visual style is promoted to a blueprint (id-aligned with the showcase repo)', () => {
    for (const s of VISUAL_STYLES) {
      const b = getBlueprint(s.id);
      expect(b).not.toBeNull();
      expect(b!.title).toBe(s.title);                       // same id + title → repository `visualStyle` keeps matching
      expect(b!.stylePrompt).toBe(s.stylePrompt);
    }
  });

  it('STEP 6 — category grouping + family filter', () => {
    const groups = listBlueprintsByCategory();
    expect(groups.map((g) => g.category)).toEqual(['photography', 'illustration', '3d', 'modern', 'marketing', 'ui']);
    // Family filter only returns blueprints that support that family.
    for (const b of listBlueprints('infographic')) expect(b.supportedFamilies).toContain('infographic');
    expect(listBlueprints('image').length).toBeGreaterThan(listBlueprints('infographic').length);
  });

  it('unknown blueprint resolves safely', () => {
    expect(getBlueprint('nope')).toBeNull();
    expect(getBlueprint(null)).toBeNull();
  });
});
