import { editorFields, editField } from '../../../lib/creator-templates/editorRuntime';
import { syncIntakeToEditor, initEditorFromIntake, INTAKE_FIELD_REGISTRY } from '../../../lib/creator-templates/intakeEditorSync';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const C1 = ['Boost activation by 92%', 'Teams struggle with slow onboarding.', 'Our solution automates it. 3x retention.', 'Get started free.'].join('\n');
const C2 = ['Cut churn by 40%', 'Renewals are unpredictable.', 'A new approach to retention.', 'Book a demo.'].join('\n');

const field = (key: string, required = false): TemplateField =>
  ({ key, label: key, control: 'text', required, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true), field('subheadline'), field('cta', true)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true), field('body')] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true), field('value')] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 1, formDefinition } as unknown as CreatorTemplate;
}
const ref = (s: ReturnType<typeof initEditorFromIntake>, r: string) => editorFields(s).find((f) => f.ref === r)!;

describe('Intake → Editor sync — one-way, deterministic (CREATOR-027B / 030 STEP 1)', () => {
  it('initEditorFromIntake builds canonical AUTO fields from intake content', () => {
    const s = initEditorFromIntake({ template: makeTemplate('carousel'), sourceText: C1 });
    expect(ref(s, 'field:headline').value).toBe('Boost activation by 92%');
    expect(ref(s, 'field:headline').owner).toBe('AUTO');
  });

  it('a new intake updates AUTO fields but NEVER overwrites MANUAL edits', () => {
    const tpl = makeTemplate('carousel');
    const s0 = initEditorFromIntake({ template: tpl, sourceText: C1 });
    const edited = editField(s0, 'field:headline', 'My manual headline');
    const synced = syncIntakeToEditor(edited, { template: tpl, sourceText: C2 });
    // MANUAL preserved through the intake change.
    expect(ref(synced, 'field:headline').owner).toBe('MANUAL');
    expect(ref(synced, 'field:headline').value).toBe('My manual headline');
    // AUTO field followed the new intake content.
    const cta = ref(synced, 'field:cta');
    expect(cta.owner).toBe('AUTO');
    expect(cta.value).toBe(synced.population.fields.cta);
  });

  it('is idempotent and loop-free — same content → no further change (one update → one propagation)', () => {
    const tpl = makeTemplate('carousel');
    const s = initEditorFromIntake({ template: tpl, sourceText: C1 });
    const once = syncIntakeToEditor(s, { template: tpl, sourceText: C1 });
    const twice = syncIntakeToEditor(once, { template: tpl, sourceText: C1 });
    expect(JSON.stringify(editorFields(once))).toBe(JSON.stringify(editorFields(twice)));
  });

  it('one-way only — there is a single owner (editorRuntime), no editor→intake writeback', () => {
    // The registry documents that brief META feeds the assembly, content feeds
    // the overlay; editorRuntime is the sole destination of editable content.
    expect(INTAKE_FIELD_REGISTRY.description).toBe('content');
    expect(INTAKE_FIELD_REGISTRY.audience).toBe('assembly:audience');
  });

  it('deterministic across families', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const tpl = makeTemplate(fam);
      const a = initEditorFromIntake({ template: tpl, sourceText: C1 });
      const b = initEditorFromIntake({ template: tpl, sourceText: C1 });
      expect(JSON.stringify(editorFields(a))).toBe(JSON.stringify(editorFields(b)));
    }
  });
});
