import {
  listTemplatesForFamily,
  buildVisualChecklist,
  buildContentChecklist,
  buildVersionHistory,
  checklistScore,
} from '../../../lib/creator-templates';
import { initTemplateValues } from '../../../lib/creator-templates/values';

const find = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = find('image', 'sys-image-headline-sub-cta');
const car = find('carousel', 'sys-carousel-educational-5');
const info = find('infographic', 'sys-infographic-statistics');

const fillAll = (t: any) => {
  const v = initTemplateValues(t);
  for (const f of t.formDefinition.fields) v.fields[f.key] = 'value';
  if (t.formDefinition.slides && v.slides) v.slides.forEach((r: any) => t.formDefinition.slides.fields.forEach((f: any) => { r[f.key] = 'slide'; }));
  if (t.formDefinition.sections && v.sections) v.sections.forEach((r: any) => t.formDefinition.sections.fields.forEach((f: any) => { r[f.key] = '42'; }));
  return v;
};

describe('CREATOR-011 asset review (deterministic, metadata-only)', () => {
  it('image visual checklist: headline + CTA + branding', () => {
    const items = buildVisualChecklist(img, fillAll(img), { brandingProfile: 'balanced' });
    expect(items.some((i) => /headline/i.test(i.label))).toBe(true);
    expect(items.some((i) => /branding/i.test(i.label) && i.ok)).toBe(true);
    expect(items.every((i) => i.ok)).toBe(true);
    const empty = buildVisualChecklist(img, initTemplateValues(img), {});
    expect(empty.find((i) => /headline/i.test(i.label))!.ok).toBe(false);
  });

  it('carousel visual checklist: slide count + cover + closing CTA', () => {
    const items = buildVisualChecklist(car, fillAll(car));
    expect(items.some((i) => /slide count/i.test(i.label) && i.ok)).toBe(true);
    expect(items.some((i) => /cover/i.test(i.label) && i.ok)).toBe(true);
  });

  it('infographic visual checklist: title + section count + statistics', () => {
    const items = buildVisualChecklist(info, fillAll(info));
    expect(items.some((i) => /section count/i.test(i.label) && i.ok)).toBe(true);
    expect(items.some((i) => /statistic/i.test(i.label) && i.ok)).toBe(true);
  });

  it('content checklist reuses readiness: required + optional + CTA', () => {
    const empty = buildContentChecklist(img, initTemplateValues(img));
    expect(empty.find((i) => /required/i.test(i.label))!.ok).toBe(false);
    const full = buildContentChecklist(img, fillAll(img));
    expect(full.find((i) => /required/i.test(i.label))!.ok).toBe(true);
  });

  it('checklistScore summarises pass/total', () => {
    const s = checklistScore(buildVisualChecklist(info, fillAll(info)));
    expect(s.total).toBeGreaterThan(0);
    expect(s.allOk).toBe(true);
    expect(s.passed).toBe(s.total);
  });

  it('version history: original always, regenerated + edited appended', () => {
    const base = buildVersionHistory({ createdAt: '2026-06-26T00:00:00Z', templateVersion: 1 });
    expect(base.length).toBe(1);
    expect(base[0].kind).toBe('original');
    const full = buildVersionHistory({ createdAt: '2026-06-26T00:00:00Z', templateVersion: 2, regenerations: 2, edited: true });
    expect(full.map((e) => e.kind)).toEqual(['original', 'regenerated', 'regenerated', 'edited']);
    expect(full[full.length - 1].label).toMatch(/edited/i);
  });

  it('is deterministic', () => {
    const v = fillAll(car);
    expect(buildVisualChecklist(car, v)).toEqual(buildVisualChecklist(car, v));
    expect(buildContentChecklist(car, v)).toEqual(buildContentChecklist(car, v));
  });
});
