import {
  listTemplatesForFamily,
  assessField,
  countContent,
  computeEditorProgress,
  buildFieldNav,
  fieldAnchorId,
} from '../../../lib/creator-templates';
import { initTemplateValues } from '../../../lib/creator-templates/values';

const find = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = find('image', 'sys-image-headline-sub-cta');
const car = find('carousel', 'sys-carousel-educational-5');
const info = find('infographic', 'sys-infographic-statistics');

const fillAll = (t: any) => {
  const v = initTemplateValues(t);
  for (const f of t.formDefinition.fields) v.fields[f.key] = 'value';
  if (t.formDefinition.slides && v.slides) v.slides.forEach((r: any) => t.formDefinition.slides.fields.forEach((f: any) => { r[f.key] = 'slide content'; }));
  if (t.formDefinition.sections && v.sections) v.sections.forEach((r: any) => t.formDefinition.sections.fields.forEach((f: any) => { r[f.key] = '42'; }));
  return v;
};

describe('CREATOR-009 editor assist (deterministic, measure/validate/guide)', () => {
  it('assessField: required-empty, complete, and too-long statuses', () => {
    const req = { key: 'h', label: 'H', control: 'input', required: true, aiAssist: {} } as any;
    expect(assessField(req, '').status).toBe('required');
    expect(assessField(req, 'ok').status).toBe('complete');
    const capped = { ...req, maxLength: 5 } as any;
    const a = assessField(capped, 'way too long');
    expect(a.status).toBe('attention');
    expect(a.over).toBe(true);
    expect(a.message).toMatch(/Too long/);
    const opt = { key: 'o', label: 'O', control: 'input', required: false, aiAssist: {} } as any;
    expect(assessField(opt, '').status).toBe('empty');
  });

  it('countContent reuses ingestion classification', () => {
    const c = countContent('First line.\n\nSecond paragraph here.\n\n- a bullet\n\n92% stat\n\n"a quote"');
    expect(c.characters).toBeGreaterThan(0);
    expect(c.words).toBeGreaterThan(0);
    expect(c.paragraphs).toBeGreaterThanOrEqual(2);
    expect(c.bullets).toBe(1);
    expect(c.statistics).toBe(1);
    expect(c.quotes).toBe(1);
  });

  it('progress: empty → 0% with all required remaining; full → 100%', () => {
    for (const t of [img, car, info]) {
      const empty = computeEditorProgress(t, initTemplateValues(t));
      expect(empty.completionPct).toBe(0);
      expect(empty.requiredRemaining).toBe(empty.requiredTotal);
      const full = computeEditorProgress(t, fillAll(t));
      expect(full.completionPct).toBe(100);
      expect(full.requiredRemaining).toBe(0);
    }
  });

  it('progress: slides/sections completed + statistics counted', () => {
    const cp = computeEditorProgress(car, fillAll(car));
    expect(cp.slidesTotal).toBe(car.formDefinition.slides!.defaultCount);
    expect(cp.slidesCompleted).toBe(cp.slidesTotal);
    const ip = computeEditorProgress(info, fillAll(info));
    expect(ip.sectionsTotal).toBeGreaterThan(0);
    expect(ip.sectionsCompleted).toBe(ip.sectionsTotal);
    expect(ip.statistics).toBeGreaterThan(0);
  });

  it('progress: CTA tracked when the template has one', () => {
    const p0 = computeEditorProgress(img, initTemplateValues(img));
    if (p0.hasCta) {
      expect(p0.ctaFilled).toBe(false);
      const cta = img.formDefinition.fields.find((f) => /cta/i.test(f.key))!;
      const v = initTemplateValues(img); v.fields[cta.key] = 'Learn more';
      expect(computeEditorProgress(img, v).ctaFilled).toBe(true);
    }
  });

  it('navigation targets: errors for required-empty, warnings for empty optionals, ok for filled', () => {
    const nav = buildFieldNav(img, initTemplateValues(img));
    expect(nav.length).toBeGreaterThan(0);
    expect(nav.some((n) => n.severity === 'error')).toBe(true); // required headline empty
    const full = buildFieldNav(img, fillAll(img));
    expect(full.every((n) => n.severity === 'ok')).toBe(true);
    // anchors are stable + unique
    const ids = nav.map((n) => n.anchorId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nav[0].anchorId).toBe(fieldAnchorId('flat', img.formDefinition.fields[0].key));
  });

  it('is deterministic', () => {
    const v = fillAll(info);
    expect(computeEditorProgress(info, v)).toEqual(computeEditorProgress(info, v));
    expect(buildFieldNav(info, v)).toEqual(buildFieldNav(info, v));
  });
});
