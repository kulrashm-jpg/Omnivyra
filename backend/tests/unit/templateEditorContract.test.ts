import { listTemplatesForFamily } from '../../../lib/creator-templates';
import { initTemplateValues, validateTemplateValues, migrateTemplateValues, type TemplateFieldValues } from '../../../lib/creator-templates/values';

const byId = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const imgA = byId('image', 'sys-image-headline-sub-cta'); // headline(req), subheadline, cta
const imgB = byId('image', 'sys-image-quote-author');     // quote(req), author
const carA = byId('carousel', 'sys-carousel-educational-5'); // [5,7,10] default 5; title(req), body
const carB = byId('carousel', 'sys-carousel-checklist-10');
const infoA = byId('infographic', 'sys-infographic-statistics'); // headline(req); sections 2..6 metric(req)+description(req)
const infoB = byId('infographic', 'sys-infographic-process');    // sections step(req)+description

describe('CAMPAIGN-002 editor validation (deterministic, contract-driven)', () => {
  it('flags required + length on image fields', () => {
    expect(validateTemplateValues(imgA, initTemplateValues(imgA)).ok).toBe(false); // headline required
    const ok: TemplateFieldValues = { fields: { headline: 'Hello', subheadline: '', cta: '' } };
    expect(validateTemplateValues(imgA, ok).ok).toBe(true);
    const tooLong: TemplateFieldValues = { fields: { headline: 'x'.repeat(500) } };
    expect(validateTemplateValues(imgA, tooLong).messages.join(' ')).toMatch(/exceeds/);
  });

  it('flags carousel slide-count + per-slide required title', () => {
    const init = initTemplateValues(carA); // 5 empty slides
    expect(validateTemplateValues(carA, init).ok).toBe(false); // titles required
    const filled: TemplateFieldValues = { fields: {}, slideCount: 5, slides: Array.from({ length: 5 }, (_u, i) => ({ title: `T${i}`, body: '' })) };
    expect(validateTemplateValues(carA, filled).ok).toBe(true);
    const badCount: TemplateFieldValues = { fields: {}, slideCount: 4, slides: Array.from({ length: 4 }, () => ({ title: 'T', body: '' })) };
    expect(validateTemplateValues(carA, badCount).messages.join(' ')).toMatch(/Slide count must be one of/);
  });

  it('flags infographic section count bounds', () => {
    const filled = (n: number): TemplateFieldValues => ({ fields: { headline: 'Title' }, sections: Array.from({ length: n }, () => ({ metric: '9%', description: 'd' })) });
    expect(validateTemplateValues(infoA, filled(3)).ok).toBe(true);
    expect(validateTemplateValues(infoA, filled(1)).messages.join(' ')).toMatch(/At least 2/);
    expect(validateTemplateValues(infoA, filled(7)).messages.join(' ')).toMatch(/At most 6/);
  });
});

describe('CAMPAIGN-002 template-switch migration (deterministic)', () => {
  it('preserves compatible slides across same-family carousel switch', () => {
    const v: TemplateFieldValues = { fields: {}, slideCount: 5, slides: Array.from({ length: 5 }, (_u, i) => ({ title: `T${i}`, body: `B${i}` })) };
    const { values, preserved } = migrateTemplateValues(carA, carB, v);
    expect(values.slides!.length).toBe(5);          // 5 ∈ checklist countOptions → kept
    expect(values.slides![0].title).toBe('T0');     // preserved by key
    expect(values.slides![0].body).toBe('B0');
    expect(preserved.some((p) => p.startsWith('slide['))).toBe(true);
  });

  it('drops fields with no key match (image → image)', () => {
    const v: TemplateFieldValues = { fields: { headline: 'Keep?', subheadline: 'sub', cta: 'Go' } };
    const { values, preserved, dropped } = migrateTemplateValues(imgA, imgB, v);
    expect(values.fields.quote).toBe('');           // target field, empty
    expect(values.fields.headline).toBeUndefined(); // not a field of imgB
    expect(preserved).toEqual([]);                  // no shared keys
    expect(dropped).toContain('field.headline');
  });

  it('cross-family switch never corrupts (image → carousel)', () => {
    const v: TemplateFieldValues = { fields: { headline: 'Hi' } };
    const { values, dropped } = migrateTemplateValues(imgA, carA, v);
    expect(Array.isArray(values.slides)).toBe(true);     // target init slides
    expect(values.slides!.every((s) => s.title === '')).toBe(true);
    expect(dropped).toContain('field.headline');
  });

  it('preserves shared section fields by key (infographic → infographic)', () => {
    const v: TemplateFieldValues = { fields: { headline: 'T' }, sections: [{ metric: '9%', description: 'desc-kept' }, { metric: '3x', description: 'two' }] };
    const { values, preserved, dropped } = migrateTemplateValues(infoA, infoB, v);
    expect(values.sections![0].description).toBe('desc-kept'); // shared key preserved
    expect(values.sections![0].step).toBe('');                 // new required field, empty
    expect(preserved.some((p) => p.includes('.description'))).toBe(true);
    expect(dropped.some((p) => p.includes('.metric'))).toBe(true);
  });
});
