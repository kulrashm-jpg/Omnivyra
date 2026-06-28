import { SYSTEM_TEMPLATES } from '../../../lib/creator-templates/systemTemplates';
import { getTemplateById } from '../../../lib/creator-templates';
import {
  VISUAL_STYLES, getVisualStyle, listVisualStyles, STYLE_VARIANT_ALIASES,
  resolveTemplateStyle, isStyleVariantAlias, canonicalTemplateIds, stylesForBaseTemplate,
} from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { getShowcasesForOutcome, repositoryStats } from '../../../lib/creator-outcomes/creatorShowcaseRepository';
import { listOutcomes } from '../../../lib/creator-outcomes/outcomeRegistry';

const REQUIRED = ['corporate', 'modern', 'minimal', 'luxury', 'editorial', 'magazine', 'lifestyle', 'real-photography', 'product-photography', 'technology', 'healthcare', 'finance', 'education', 'construction', 'restaurant', 'travel', 'retail', 'fashion', 'dark', 'bold', 'graffiti', 'comic', 'anime', 'clay', '3d', 'watercolor', 'sketch', 'isometric', 'glassmorphism', 'cyberpunk', 'futuristic', 'ui-mockup', 'dashboard', 'infographic'];
const allImageIds = SYSTEM_TEMPLATES.image.map((t) => t.id);

describe('CREATOR-051 — Visual Style registry + template normalization', () => {
  it('STEP 1/2 — ≥48 styles, unique ids, all fields populated, required styles present', () => {
    expect(VISUAL_STYLES.length).toBeGreaterThanOrEqual(48);
    expect(new Set(VISUAL_STYLES.map((s) => s.id)).size).toBe(VISUAL_STYLES.length);
    for (const s of VISUAL_STYLES) {
      expect(s.title.length).toBeGreaterThan(1);
      expect(s.description.length).toBeGreaterThan(3);
      expect(s.thumbnail.accent).toMatch(/^#/);
      expect(s.thumbnail.surface).toMatch(/^#/);
      expect(s.icon.length).toBeGreaterThan(1);
      expect(Array.isArray(s.tags)).toBe(true);
      expect(s.supportedFamilies.length).toBeGreaterThan(0);
      expect(typeof s.stylePrompt).toBe('string');
      expect(typeof s.brandBehavior).toBe('string');
    }
    for (const id of REQUIRED) expect(getVisualStyle(id)).not.toBeNull();
    expect(listVisualStyles('infographic').some((s) => s.id === 'infographic')).toBe(true);
  });

  it('STEP 3/7 — aliases collapse color-only variants to base + style; template IDs preserved', () => {
    for (const [aliasId, res] of Object.entries(STYLE_VARIANT_ALIASES)) {
      // The alias id STILL resolves to a real template (runtime/recommendation/analytics intact).
      expect(getTemplateById(aliasId, 'image')).not.toBeNull();
      // Resolves to a real base template + a real style.
      expect(getTemplateById(res.baseTemplateId, 'image')).not.toBeNull();
      expect(getVisualStyle(res.styleId)).not.toBeNull();
      expect(res.isAlias).toBe(true);
      // A base is never itself an alias.
      expect(isStyleVariantAlias(res.baseTemplateId)).toBe(false);
      expect(resolveTemplateStyle(aliasId)).toEqual(res);
    }
    // Every system template id still resolves (no broken ids).
    for (const t of [...SYSTEM_TEMPLATES.image, ...SYSTEM_TEMPLATES.carousel, ...SYSTEM_TEMPLATES.infographic]) {
      expect(getTemplateById(t.id, t.assetFamily)).not.toBeNull();
    }
  });

  it('STEP 8 — canonical browse list dedupes the 6 color-only variants (no duplicate templates)', () => {
    const canon = canonicalTemplateIds(allImageIds);
    expect(allImageIds.length - canon.length).toBe(Object.keys(STYLE_VARIANT_ALIASES).length); // exactly 6 removed
    for (const aliasId of Object.keys(STYLE_VARIANT_ALIASES)) expect(canon).not.toContain(aliasId);
    expect(canon).toContain('sys-image-minimal-brand-card'); // base retained
    expect(new Set(canon).size).toBe(canon.length);          // no dupes
    // The base offers all absorbed styles in the style selector.
    expect(stylesForBaseTemplate('sys-image-minimal-brand-card').sort()).toEqual(['bold', 'corporate', 'editorial', 'illustration', 'luxury', 'minimal', 'technology'].sort());
  });

  it('STEP 6 — curated repository carries the canonical metadata model; styles are valid', () => {
    expect(repositoryStats()).toEqual(expect.objectContaining({ total: expect.any(Number), templates: expect.any(Number), outcomes: expect.any(Number) }));
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        const shows = getShowcasesForOutcome(o.id, f);
        expect(Array.isArray(shows)).toBe(true);
        for (const s of shows) {                              // empty until curated, but model is enforced when present
          expect(getVisualStyle(s.visualStyle)).not.toBeNull();
          expect(s.businessOutcome).toBe(o.id);
          expect(s.family).toBe(f);
          expect(s.thumbnailUrl.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('STEP 5 — recommendation untouched: non-alias template resolves to itself + a default style', () => {
    expect(resolveTemplateStyle('sys-image-product-highlight')).toEqual({ baseTemplateId: 'sys-image-product-highlight', styleId: 'modern', isAlias: false });
    expect(resolveTemplateStyle('sys-image-minimal-brand-card')).toEqual({ baseTemplateId: 'sys-image-minimal-brand-card', styleId: 'minimal', isAlias: false });
  });
});
