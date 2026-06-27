import { listTemplatesForFamily } from '../../../lib/creator-templates';
import {
  searchTemplates, listStyleVariants, templateVariantKey, variantLabel, deriveBadges,
} from '../../../lib/creator-templates/discovery';

describe('TEMPLATE-016 gallery discovery (canonical, deterministic)', () => {
  const image = listTemplatesForFamily('image');
  const carousel = listTemplatesForFamily('carousel');
  const infographic = listTemplatesForFamily('infographic');

  it('lists the style variants present in a family', () => {
    const v = listStyleVariants(image);
    expect(v.length).toBeGreaterThan(1);
    expect(v).toEqual([...v].sort()); // sorted, deterministic
    // every template resolves to one of the listed variants
    for (const t of image) expect(v).toContain(templateVariantKey(t));
  });

  it('Style Variant filter returns only that variant', () => {
    const variant = listStyleVariants(infographic).find((x) => x !== 'default') ?? 'default';
    const res = searchTemplates(infographic, '', { variant });
    expect(res.length).toBeGreaterThan(0);
    for (const t of res) expect(templateVariantKey(t)).toBe(variant);
  });

  it('Category filter returns only that category', () => {
    const cat = carousel[0].category;
    const res = searchTemplates(carousel, '', { category: cat });
    expect(res.length).toBeGreaterThan(0);
    for (const t of res) expect(t.category).toBe(cat);
  });

  it('search matches name / description / tags', () => {
    const t = image[0];
    expect(searchTemplates(image, t.name).map((x) => x.id)).toContain(t.id);
    if (t.tags[0]) expect(searchTemplates(image, t.tags[0]).map((x) => x.id)).toContain(t.id);
  });

  it('deriveBadges emits recommended + style-variant badges on request', () => {
    const t = infographic[0];
    const badges = deriveBadges(t, { recommended: true, showVariant: true });
    expect(badges.some((b) => b.kind === 'recommended')).toBe(true);
    const variantBadge = badges.find((b) => b.kind === 'variant');
    expect(variantBadge?.label).toBe(variantLabel(templateVariantKey(t)));
    // default behavior unchanged when not requested
    expect(deriveBadges(t).some((b) => b.kind === 'recommended' || b.kind === 'variant')).toBe(false);
  });

  it('variantLabel humanizes keys', () => {
    expect(variantLabel('executive-report')).toBe('Executive Report');
    expect(variantLabel('dark')).toBe('Dark');
  });
});
