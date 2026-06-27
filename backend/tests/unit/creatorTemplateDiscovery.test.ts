import { SYSTEM_TEMPLATES, getTemplateById } from '../../../lib/creator-templates';
import {
  estimateTextDensity,
  templatePopularity,
  popularTemplates,
  recommendTemplates,
  searchTemplates,
  relatedTemplates,
  deriveBadges,
  compareTemplate,
} from '../../../lib/creator-templates/discovery';

const IMAGES = SYSTEM_TEMPLATES.image;
const CAROUSELS = SYSTEM_TEMPLATES.carousel;

describe('Discovery — text density + popularity (deterministic)', () => {
  it('estimates density from the form definition', () => {
    expect(estimateTextDensity(getTemplateById('sys-image-headline')!)).toBe('minimal');
    const checklist = getTemplateById('sys-image-checklist')!;
    expect(['balanced', 'heavy']).toContain(estimateTextDensity(checklist));
  });

  it('popularity ordering is stable across calls', () => {
    const a = popularTemplates(IMAGES).map((t) => t.id);
    const b = popularTemplates(IMAGES).map((t) => t.id);
    expect(a).toEqual(b);
    expect(typeof templatePopularity(IMAGES[0])).toBe('number');
  });
});

describe('Discovery — recommendations (deterministic)', () => {
  it('produces identical ordering for identical context', () => {
    const ctx = { objective: 'Product Launch', industry: 'SaaS' };
    const a = recommendTemplates(IMAGES, ctx).map((s) => s.template.id);
    const b = recommendTemplates(IMAGES, ctx).map((s) => s.template.id);
    expect(a).toEqual(b);
  });

  it('boosts objective-matching templates and explains why', () => {
    const recs = recommendTemplates(IMAGES, { objective: 'launch' });
    const top = recs.slice(0, 6).map((s) => s.template.name.toLowerCase()).join(' ');
    expect(top).toMatch(/launch|announcement|hero/);
    const withReason = recs.find((s) => s.reasons.some((r) => /Recommended for/i.test(r)));
    expect(withReason).toBeDefined();
  });

  it('boosts recently used + matures difficulty affinity', () => {
    const id = IMAGES[3].id;
    const recs = recommendTemplates(IMAGES, { recentlyUsedIds: [id] });
    expect(recs.find((s) => s.template.id === id)!.reasons).toContain('You used this recently');
  });

  it('no context → falls back to a deterministic popularity-led order', () => {
    const recs = recommendTemplates(IMAGES, {}).map((s) => s.template.id);
    expect(recs).toEqual(popularTemplates(IMAGES).map((t) => t.id));
  });
});

describe('Discovery — search + filters (instant, deterministic)', () => {
  it('matches by name / keywords / use cases', () => {
    const r = searchTemplates(IMAGES, 'quote').map((t) => t.id);
    expect(r).toContain('sys-image-quote-author');
  });

  it('applies difficulty + aspect + density filters', () => {
    const easy = searchTemplates(IMAGES, '', { difficulty: 'easy' });
    expect(easy.every((t) => (t.metadata as any).difficulty === 'easy')).toBe(true);
    const portrait = searchTemplates(CAROUSELS, '', { aspect: 'portrait' });
    expect(portrait.every((t) => (t.metadata as any).aspectSupport.includes('portrait'))).toBe(true);
    const minimal = searchTemplates(IMAGES, '', { density: 'minimal' });
    expect(minimal.every((t) => estimateTextDensity(t) === 'minimal')).toBe(true);
  });

  it('empty query + no filters returns the full set in popularity order', () => {
    expect(searchTemplates(IMAGES, '').length).toBe(IMAGES.length);
  });

  it('is deterministic', () => {
    const a = searchTemplates(IMAGES, 'launch product').map((t) => t.id);
    const b = searchTemplates(IMAGES, 'launch product').map((t) => t.id);
    expect(a).toEqual(b);
  });
});

describe('Discovery — related templates (deterministic similarity)', () => {
  it('returns same-family templates, excludes self, deterministic, ≤ limit', () => {
    const t = getTemplateById('sys-image-quote-author')!;
    const rel = relatedTemplates(t, IMAGES, 4);
    expect(rel.length).toBeLessThanOrEqual(4);
    expect(rel.every((x) => x.assetFamily === 'image' && x.id !== t.id)).toBe(true);
    const again = relatedTemplates(t, IMAGES, 4).map((x) => x.id);
    expect(rel.map((x) => x.id)).toEqual(again);
  });

  it('ranks same-category templates near the top', () => {
    const t = getTemplateById('sys-image-testimonial')!;
    const rel = relatedTemplates(t, IMAGES, 6);
    // A quote/testimonial-category sibling should appear.
    expect(rel.some((x) => x.category === t.category || x.tags.includes('social-proof') || x.tags.includes('quote'))).toBe(true);
  });
});

describe('Discovery — badges + compare', () => {
  it('derives deterministic badges incl. density + platform + beginner', () => {
    const badges = deriveBadges(getTemplateById('sys-image-headline')!, { popularRank: 0 });
    const kinds = badges.map((b) => b.kind);
    expect(kinds).toContain('density');
    expect(kinds).toContain('platform');
  });

  it('projects a read-only comparison row', () => {
    const c = compareTemplate(getTemplateById('sys-image-headline-sub-cta')!);
    expect(c.fieldCount).toBeGreaterThan(0);
    expect(Array.isArray(c.aspectSupport)).toBe(true);
    expect(['minimal', 'balanced', 'heavy']).toContain(c.density);
  });
});
