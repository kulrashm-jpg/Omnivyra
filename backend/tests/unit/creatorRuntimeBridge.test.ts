import { projectImageOverlayText, projectCarouselSlides, projectInfographicSections, initTemplateValues, type TemplateFieldValues } from '../../../lib/creator-templates/values';
import { editorFields, editField, effectivePopulation } from '../../../lib/creator-templates/editorRuntime';
import {
  liveContentToEditorState, editorStateToGeneratePayload, populationToTemplateFieldValues, runTypographyGate,
} from '../../../lib/creator-templates/creatorRuntimeBridge';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const WRITER_CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  'Get started free today. Sign up now.',
].join('\n');
const CREATOR_BRIEF = 'Announce our analytics suite. 4x faster reporting. Try it free.';

const field = (key: string, required = false, maxLength?: number): TemplateField =>
  ({ key, label: key, control: 'text', required, maxLength, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true, 80), field('subheadline', false, 120), field('cta', true, 28)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true, 80), field('body', false, 200)] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true, 60), field('value', false, 40)] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 2, formDefinition } as unknown as CreatorTemplate;
}

describe('Creator Runtime Bridge — editorRuntime is the single live source (CREATOR-029)', () => {
  it('STEP 2 — liveContentToEditorState seeds deterministic AUTO + user MANUAL (lossless)', () => {
    const tpl = makeTemplate('carousel');
    const state = liveContentToEditorState({ template: tpl, sourceText: WRITER_CONTENT, existingValues: { fields: { headline: 'User headline wins', subheadline: '', cta: '' } } });
    const fields = editorFields(state);
    const headline = fields.find((f) => f.ref === 'field:headline')!;
    expect(headline.value).toBe('User headline wins');   // user input preserved
    expect(headline.owner).toBe('MANUAL');
    const cta = fields.find((f) => f.ref === 'field:cta')!;
    expect(cta.owner).toBe('AUTO');                       // deterministic canonical
    expect(cta.value.length).toBeGreaterThan(0);
  });

  it('STEP 4 — the bridge payload is BYTE-IDENTICAL to the legacy projector path for the same values', () => {
    const tpl = makeTemplate('image');
    const state = liveContentToEditorState({ template: tpl, sourceText: WRITER_CONTENT });
    // Legacy path: the same effective values fed straight into the renderer's projectors.
    const values: TemplateFieldValues = populationToTemplateFieldValues(effectivePopulation(state));
    const legacy = { overlay_text: { ...projectImageOverlayText(tpl, values), __template_authoritative: true }, template_fields: values.fields };
    const bridged = editorStateToGeneratePayload(state, tpl);
    expect(JSON.stringify(bridged)).toBe(JSON.stringify(legacy)); // renderer input unchanged
  });

  it('STEP 4 — carousel + infographic payloads reuse the same projectors', () => {
    const car = makeTemplate('carousel');
    const carState = liveContentToEditorState({ template: car, sourceText: WRITER_CONTENT });
    const carValues = populationToTemplateFieldValues(effectivePopulation(carState));
    expect(JSON.stringify(editorStateToGeneratePayload(carState, car).slides)).toBe(JSON.stringify(projectCarouselSlides(carValues)));

    const ig = makeTemplate('infographic');
    const igState = liveContentToEditorState({ template: ig, sourceText: WRITER_CONTENT });
    const igValues = populationToTemplateFieldValues(effectivePopulation(igState));
    expect(JSON.stringify(editorStateToGeneratePayload(igState, ig).infographic_sections)).toBe(JSON.stringify(projectInfographicSections(igValues)));
  });

  it('a manual edit flows into the generate payload (payload originates from editorRuntime)', () => {
    const tpl = makeTemplate('image');
    const state = editField(liveContentToEditorState({ template: tpl, sourceText: WRITER_CONTENT }), 'field:headline', 'Exactly This Headline');
    const payload = editorStateToGeneratePayload(state, tpl);
    expect((payload.overlay_text as Record<string, string>).headline).toBe('Exactly This Headline');
  });

  it('STEP 5 — typography gate runs and passes for canonical content', () => {
    const tpl = makeTemplate('carousel');
    const gate = runTypographyGate(liveContentToEditorState({ template: tpl, sourceText: WRITER_CONTENT }), tpl);
    expect(gate.ok).toBe(true);
    expect(['PASS', 'WARN']).toContain(gate.status);
    expect(gate.report.editorBindingValid).toBe(true);
    expect(gate.report.previewRendererParity).toBe(true);
  });

  it('writer-first AND creator-first, across image / carousel / infographic, are deterministic', () => {
    for (const content of [WRITER_CONTENT, CREATOR_BRIEF]) {
      for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
        const tpl = makeTemplate(fam);
        const a = editorStateToGeneratePayload(liveContentToEditorState({ template: tpl, sourceText: content }), tpl);
        const b = editorStateToGeneratePayload(liveContentToEditorState({ template: tpl, sourceText: content }), tpl);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.template_fields).toBeDefined();
      }
    }
  });

  it('empty form (writer-first, nothing typed) yields deterministic canonical payload', () => {
    const tpl = makeTemplate('image');
    const state = liveContentToEditorState({ template: tpl, sourceText: WRITER_CONTENT, existingValues: initTemplateValues(tpl) });
    expect(editorFields(state).every((f) => f.owner === 'AUTO')).toBe(true);
    const payload = editorStateToGeneratePayload(state, tpl);
    expect((payload.overlay_text as Record<string, string>).headline.length).toBeGreaterThan(0);
  });
});
