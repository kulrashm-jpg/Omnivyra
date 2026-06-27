import { listTemplatesForFamily, buildTemplateBlueprint, computeReadiness, initTemplateValues } from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';

const find = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = find('image', 'sys-image-headline-sub-cta');
const car = find('carousel', 'sys-carousel-educational-5');
const info = find('infographic', 'sys-infographic-statistics');

describe('CREATOR-006 content blueprint (deterministic, canonical metadata)', () => {
  it('image blueprint: single visual flow, deliverable, effort/time', () => {
    const b = buildTemplateBlueprint(img);
    expect(b.family).toBe('image');
    expect(b.unitLabel).toBeNull();
    expect(b.deliverable.toLowerCase()).toMatch(/image|banner/);
    const kinds = b.structure.map((s) => s.kind);
    expect(kinds[0]).toBe('headline');
    expect(b.requiredFields.length).toBeGreaterThan(0);
    expect(b.estimatedMinutes).toBeGreaterThanOrEqual(1);
    expect(['Low', 'Medium', 'High']).toContain(b.editingEffort);
  });

  it('carousel blueprint: cover → slides → closing matches slide count', () => {
    const b = buildTemplateBlueprint(car);
    expect(b.unitLabel).toBe('slides');
    expect(b.unitCount).toBe(car.formDefinition.slides!.defaultCount);
    expect(b.structure.length).toBe(b.unitCount);
    expect(b.structure[0].kind).toBe('cover');
    expect(b.structure[b.structure.length - 1].kind).toBe('closing');
  });

  it('infographic blueprint: title → sections → conclusion/cta', () => {
    const b = buildTemplateBlueprint(info);
    expect(b.unitLabel).toBe('sections');
    expect(b.unitRange).toBe(`${info.formDefinition.sections!.min}–${info.formDefinition.sections!.max}`);
    expect(b.structure[0].kind).toBe('title');
    const sectionSteps = b.structure.filter((s) => s.kind === 'section').length;
    expect(sectionSteps).toBe(b.unitCount);
  });

  it('every system template derives a non-empty blueprint', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as const) {
      for (const t of listTemplatesForFamily(fam)) {
        const b = buildTemplateBlueprint(t);
        expect(b.structure.length).toBeGreaterThan(0);
        expect(b.deliverable).toBeTruthy();
      }
    }
  });

  it('user templates derive a blueprint identically', () => {
    const u = cloneTemplate(img, 'image', { id: 'ut-bp', ownerUserId: 'u' });
    const b = buildTemplateBlueprint(u);
    expect(b.requiredFields.length).toBe(buildTemplateBlueprint(img).requiredFields.length);
  });

  it('readiness: empty → Needs More Content; partial → Almost Ready; full → Ready', () => {
    expect(computeReadiness(info)).toBe('Needs More Content'); // no values
    const empty = initTemplateValues(info);
    expect(computeReadiness(info, empty)).toBe('Needs More Content');
    // fill one required flat field only
    const reqFlat = info.formDefinition.fields.find((f) => f.required);
    if (reqFlat) {
      const partial = { ...empty, fields: { ...empty.fields, [reqFlat.key]: 'X' } };
      expect(computeReadiness(info, partial)).toBe('Almost Ready');
    }
  });

  it('readiness is Ready when all required fields are filled', () => {
    const empty = initTemplateValues(img);
    const full = { ...empty, fields: { ...empty.fields } };
    for (const f of img.formDefinition.fields) if (f.required) full.fields[f.key] = 'value';
    expect(computeReadiness(img, full)).toBe('Ready');
  });
});
