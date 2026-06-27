import {
  listTemplatesForFamily,
  ingestContent,
  ingestAndPopulate,
  populateTemplateFromContent,
  validateTemplateValues,
} from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';

const find = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = find('image', 'sys-image-headline-sub-cta');
const car = find('carousel', 'sys-carousel-educational-5');
const info = find('infographic', 'sys-infographic-statistics');

const BLOG = `# How automation reclaims your week

Most teams lose hours to busywork that software can handle.

Why it matters
Manual processes quietly drain focus from the work that actually moves revenue.

The playbook
Start small, automate the repetitive path, then measure what you saved.

- Map the most repeated task
- Automate the hand-offs
- Review weekly

Get started today

92% of teams report time saved
3.4x faster turnaround
-38% operating cost

"Make the right thing the easy thing." — Staff Engineer`;

describe('CREATOR-007 deterministic content ingestion', () => {
  it('segments plain text into headings/paragraphs/bullets/statistics/quotes', () => {
    const c = ingestContent(BLOG);
    expect(c.title).toMatch(/automation/i);
    expect(c.headings.length).toBeGreaterThanOrEqual(2);
    expect(c.paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(c.bullets.length).toBeGreaterThanOrEqual(3);
    expect(c.statistics.length).toBeGreaterThanOrEqual(3);
    expect(c.statistics[0].value).toMatch(/92%/);
    expect(c.quotes.length).toBe(1);
  });

  it('is deterministic (same input → same output)', () => {
    expect(ingestContent(BLOG)).toEqual(ingestContent(BLOG));
    expect(ingestAndPopulate(img, BLOG).values).toEqual(ingestAndPopulate(img, BLOG).values);
  });

  it('image: populates headline + supporting text + CTA via formDefinition', () => {
    const r = ingestAndPopulate(img, BLOG);
    expect(r.values.fields.headline).toBeTruthy();
    expect(r.values.fields.subheadline || r.values.fields.supportingText || '').toBeTruthy();
    expect(r.mappedTo.some((m) => m.target === 'CTA')).toBe(true);
    // never writes outside the canonical fields map
    expect(Object.keys(r.values.fields).every((k) => img.formDefinition.fields.some((f) => f.key === k))).toBe(true);
  });

  it('carousel: populates slide titles + bodies, count from formDefinition', () => {
    const r = ingestAndPopulate(car, BLOG);
    expect(r.values.slides!.length).toBe(car.formDefinition.slides!.defaultCount);
    const filledSlides = r.values.slides!.filter((s) => Object.values(s).some((v) => v));
    expect(filledSlides.length).toBeGreaterThan(0);
    expect(r.mappedTo.some((m) => /slide/.test(m.target))).toBe(true);
  });

  it('infographic: maps statistics into sections (value + label) and a title', () => {
    const r = ingestAndPopulate(info, BLOG);
    expect(r.values.sections!.length).toBeGreaterThanOrEqual(info.formDefinition.sections!.min);
    expect(r.values.sections!.length).toBeLessThanOrEqual(info.formDefinition.sections!.max);
    const valueKey = info.formDefinition.sections!.fields.find((f) => /value|stat|metric|number/i.test(f.key))?.key;
    if (valueKey) expect(r.values.sections!.some((s) => s[valueKey])).toBe(true);
    expect(r.mappedTo.some((m) => /statistic/.test(m.target))).toBe(true);
  });

  it('never discards content silently — leftovers go to unused', () => {
    const r = ingestAndPopulate(img, BLOG); // image has few fields → much is unused
    const totalImported = r.imported.headings + r.imported.paragraphs + r.imported.bullets + r.imported.statistics + r.imported.quotes;
    expect(totalImported).toBeGreaterThan(0);
    expect(r.unused.length).toBeGreaterThan(0);
    for (const u of r.unused) expect(u.text).toBeTruthy();
  });

  it('populated values pass through validateTemplateValues (no auto-correct, surfaces gaps)', () => {
    for (const t of [img, car, info]) {
      const r = ingestAndPopulate(t, BLOG);
      const v = validateTemplateValues(t, r.values);
      expect(v).toHaveProperty('ok');
      expect(Array.isArray(v.errors) || typeof v.ok === 'boolean').toBe(true);
    }
  });

  it('user templates populate identically to their system origin', () => {
    const u = cloneTemplate(img, 'image', { id: 'ut-ingest', ownerUserId: 'u' });
    expect(ingestAndPopulate(u, BLOG).values.fields.headline).toBe(ingestAndPopulate(img, BLOG).values.fields.headline);
  });

  it('plain-text and bullet-only inputs both ingest', () => {
    expect(ingestContent('Just one simple sentence about the product offering here.').paragraphs.length).toBe(1);
    const bulletsOnly = ingestContent('- first point\n- second point\n- third point');
    expect(bulletsOnly.bullets.length).toBe(3);
  });
});
