import {
  listTemplatesForFamily,
  ingestAndPopulate,
  buildReadinessReport,
  readinessStatusGlyph,
} from '../../../lib/creator-templates';
import { initTemplateValues } from '../../../lib/creator-templates/values';

const find = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = find('image', 'sys-image-headline-sub-cta');
const car = find('carousel', 'sys-carousel-educational-5');
const info = find('infographic', 'sys-infographic-statistics');

const fill = (t: any) => {
  const v = initTemplateValues(t);
  for (const f of t.formDefinition.fields) v.fields[f.key] = 'Some value here';
  if (t.formDefinition.slides && v.slides) v.slides.forEach((row: any) => t.formDefinition.slides.fields.forEach((f: any) => { row[f.key] = 'Slide content'; }));
  if (t.formDefinition.sections && v.sections) v.sections.forEach((row: any) => t.formDefinition.sections.fields.forEach((f: any) => { row[f.key] = '42'; }));
  return v;
};

describe('CREATOR-008 content readiness review (deterministic, read-only)', () => {
  it('empty content → NOT READY with blocking sections', () => {
    for (const t of [img, car, info]) {
      const r = buildReadinessReport(t, initTemplateValues(t));
      expect(r.overall).toBe('NOT READY');
      expect(r.overallStatus).toBe('blocking');
      expect(r.completeness.requiredFilled).toBe(0);
    }
  });

  it('fully filled content → READY, good overall', () => {
    for (const t of [img, car, info]) {
      const r = buildReadinessReport(t, fill(t));
      expect(r.overall).toBe('READY');
      expect(r.structure.status).toBe('good');
      expect(r.completeness.requiredMissing.length).toBe(0);
    }
  });

  it('only an optional field missing → ALMOST READY (structure still valid)', () => {
    const v = fill(img);
    const opt = img.formDefinition.fields.find((f) => !f.required);
    if (opt) {
      v.fields[opt.key] = '';
      const r = buildReadinessReport(img, v);
      expect(r.overall).toBe('ALMOST READY');
      expect(r.completeness.requiredMissing.length).toBe(0);
      expect(r.completeness.optionalEmpty).toBeGreaterThan(0);
    }
  });

  it('completeness counts required filled/missing + optional filled/empty', () => {
    const r = buildReadinessReport(img, initTemplateValues(img));
    expect(r.completeness.requiredTotal).toBeGreaterThan(0);
    expect(r.completeness.requiredMissing.length).toBe(r.completeness.requiredTotal);
    expect(r.completeness.optionalTotal).toBe(r.completeness.optionalFilled + r.completeness.optionalEmpty);
  });

  it('structure: carousel empty slides + infographic missing stats are detected', () => {
    const cr = buildReadinessReport(car, initTemplateValues(car));
    expect(cr.structure.status).toBe('blocking');
    expect(cr.structure.issues.join(' ')).toMatch(/slide/i);
    const ir = buildReadinessReport(info, initTemplateValues(info));
    expect(ir.structure.checks.some((c) => /statistic/i.test(c.label))).toBe(true);
  });

  it('quality: headline too long + duplicate slide headings flagged (no auto-correct)', () => {
    const v = fill(img);
    const hf = img.formDefinition.fields.find((f) => f.maxLength);
    if (hf) {
      v.fields[hf.key] = 'x'.repeat((hf.maxLength ?? 10) + 25);
      const r = buildReadinessReport(img, v);
      expect(r.quality.issues.join(' ')).toMatch(/exceeds/i);
    }
    const cv = fill(car);
    const tk = car.formDefinition.slides!.fields.find((f) => /title|head/i.test(f.key))?.key;
    if (tk && cv.slides) { cv.slides.forEach((row) => { row[tk] = 'Same heading'; }); const r = buildReadinessReport(car, cv); expect(r.quality.issues.join(' ')).toMatch(/duplicat/i); }
  });

  it('distribution: reports mapped, unused, and remaining capacity from ingestion', () => {
    const ing = ingestAndPopulate(img, '# Title only\n\nOne paragraph.\n\n- spare bullet one\n- spare bullet two\n\nAnother spare paragraph here for overflow.');
    const r = buildReadinessReport(img, ing.values, ing);
    expect(r.distribution.mappedCount).toBeGreaterThanOrEqual(0);
    expect(r.distribution.unusedCount).toBe(ing.unused.length);
    if (ing.unused.length > 0) { expect(r.distribution.status).toBe('attention'); expect(r.distribution.notes.join(' ')).toMatch(/unused/i); }
  });

  it('missing CTA is surfaced in quality + guidance', () => {
    const v = fill(img);
    const cta = img.formDefinition.fields.find((f) => /cta/i.test(f.key));
    if (cta) {
      v.fields[cta.key] = '';
      const r = buildReadinessReport(img, v);
      expect(r.quality.issues.concat(r.guidance).join(' ')).toMatch(/cta/i);
    }
  });

  it('guidance only identifies gaps and is de-duplicated', () => {
    const r = buildReadinessReport(car, initTemplateValues(car));
    expect(Array.isArray(r.guidance)).toBe(true);
    expect(new Set(r.guidance).size).toBe(r.guidance.length);
  });

  it('is deterministic + exposes status glyphs', () => {
    const v = fill(info);
    expect(buildReadinessReport(info, v)).toEqual(buildReadinessReport(info, v));
    expect(readinessStatusGlyph('good')).toBe('✓');
    expect(readinessStatusGlyph('attention')).toBe('!');
    expect(readinessStatusGlyph('blocking')).toBe('✕');
  });
});
