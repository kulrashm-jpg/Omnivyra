import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { createEditorState, editField, editorFields, effectivePopulation, toRenderPayload, toPreviewModel } from '../../../lib/creator-templates/editorRuntime';
import { verifyEditorBinding, verifyTypographyRuntime, typographyDiagnostics } from '../../../lib/creator-templates/typographyVerification';
import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const AT = '2026-06-26T00:00:00.000Z';
const WRITER_CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');
const CREATOR_BRIEF = 'Announce our new analytics suite. 4x faster reporting. Try it free.';

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
function stateFor(family: TemplateAssetFamily, content: string) {
  let p = createPackage('pkg-tb');
  p = addIntakeSource(p, fromExistingContent(content), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  return { state: createEditorState(population, assembly), template: makeTemplate(family) };
}
const stamp = (p: { fields: Record<string, string>; slides: Array<Record<string, string>>; sections: Array<Record<string, string>> }) => JSON.stringify({ f: p.fields, s: p.slides, x: p.sections });

describe('Editor field binding — canonical source (CREATOR-028 STEP 2)', () => {
  it('every editor field is bound to its canonical value (no legacy default, no placeholder-as-value)', () => {
    const { state } = stateFor('carousel', WRITER_CONTENT);
    const binding = verifyEditorBinding(state);
    expect(binding.valid).toBe(true);
    expect(binding.placeholderLeaks).toEqual([]);
    expect(binding.legacyDefaults).toEqual([]);
    expect(binding.duplicateState).toBe(false);
    // AUTO fields equal their canonical value verbatim.
    for (const f of editorFields(state)) if (f.owner === 'AUTO' && f.value.trim()) expect(f.value).toBe(f.canonicalValue);
  });

  it('a manual edit stays bound (MANUAL value displayed) and binding remains valid', () => {
    const { state } = stateFor('carousel', WRITER_CONTENT);
    const edited = editField(state, 'field:headline', 'Increase Revenue Using AI');
    const binding = verifyEditorBinding(edited);
    expect(binding.valid).toBe(true);
    expect(editorFields(edited).find((f) => f.ref === 'field:headline')!.value).toBe('Increase Revenue Using AI');
  });

  it('a placeholder leak is detected (negative case)', () => {
    const { state } = stateFor('image', WRITER_CONTENT);
    // Force a field's value to equal its placeholder text → must be flagged.
    const placeholder = editorFields(state).find((f) => f.ref === 'field:headline')!.placeholder;
    const leaked = editField(state, 'field:headline', placeholder);
    expect(verifyEditorBinding(leaked).valid).toBe(false);
    expect(verifyEditorBinding(leaked).placeholderLeaks).toContain('field:headline');
  });
});

describe('Editor → Preview → Renderer byte-identical (CREATOR-028 STEP 3/4/8)', () => {
  const flows: Array<{ name: string; family: TemplateAssetFamily; content: string }> = [
    { name: 'Writer → Image', family: 'image', content: WRITER_CONTENT },
    { name: 'Writer → Carousel', family: 'carousel', content: WRITER_CONTENT },
    { name: 'Writer → Infographic', family: 'infographic', content: WRITER_CONTENT },
    { name: 'Creator-first → Image', family: 'image', content: CREATOR_BRIEF },
    { name: 'Creator-first → Carousel', family: 'carousel', content: CREATOR_BRIEF },
    { name: 'Creator-first → Infographic', family: 'infographic', content: CREATOR_BRIEF },
  ];

  it.each(flows)('$name: editor == preview == renderer', ({ family, content }) => {
    const { state, template } = stateFor(family, content);
    const eff = effectivePopulation(state);
    const preview = toPreviewModel(state);
    const render = toRenderPayload(state);
    expect(stamp(eff)).toBe(stamp(preview));   // editor == preview
    expect(stamp(preview)).toBe(stamp(render)); // preview == renderer
    const r = verifyTypographyRuntime(state, template);
    expect(r.editorBindingValid).toBe(true);
    expect(r.editorPreviewParity).toBe(true);
    expect(r.previewRendererParity).toBe(true);
    expect(r.aiTypographyDetected).toBe(false);
    expect(r.source).toBe('canonical');
  });

  it('a manual headline edit flows verbatim editor → preview → renderer (no paraphrase)', () => {
    const { state } = stateFor('carousel', WRITER_CONTENT);
    const edited = editField(state, 'field:headline', 'Exactly This Headline');
    expect(toPreviewModel(edited).fields.headline).toBe('Exactly This Headline');
    expect(toRenderPayload(edited).fields.headline).toBe('Exactly This Headline');
  });

  it('diagnostics expose editorParity + canonical source + zero legacy typography', () => {
    const { state, template } = stateFor('carousel', WRITER_CONTENT);
    const d = typographyDiagnostics(state, template);
    expect(d.editorParity).toBe(true);
    expect(d.typographySource).toBe('canonical');
    expect(d.legacyTypographyUsage).toBe(0);
  });
});

describe('Prompts request imagery only (CREATOR-028 STEP 5)', () => {
  it('the real composed image prompt requests no typography (both attachment modes)', () => {
    const baseInput = (over: Record<string, unknown>) => ({ platform: 'linkedin', campaignName: 'Launch', assetType: 'image', ...over }) as any;
    for (const attachmentMode of ['supporting_visual', 'embedded_copy']) {
      const composed = composeCreatorImagePrompt(baseInput({ attachmentMode, contentType: 'image', eyebrow: 'image', purposeKey: 'promotional-image' }));
      const { state, template } = stateFor('image', WRITER_CONTENT);
      const r = verifyTypographyRuntime(state, template, composed.prompt);
      expect({ attachmentMode, promptRequestsTypography: r.promptRequestsTypography }).toEqual({ attachmentMode, promptRequestsTypography: false });
    }
  });
});
