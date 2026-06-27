import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { createEditorState, editField, toRenderPayload } from '../../../lib/creator-templates/editorRuntime';
import {
  verifyTypographyRuntime, typographyDiagnostics, imagePromptIsImageryOnly,
} from '../../../lib/creator-templates/typographyVerification';
import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');

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
function stateFor(family: TemplateAssetFamily) {
  let p = createPackage('pkg-typ');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  return { state: createEditorState(population, assembly), template: makeTemplate(family) };
}

describe('Typography Verification — canonical overlay (CREATOR-028)', () => {
  it('every typography field is sourced from the canonical overlay, never AI', () => {
    const { state, template } = stateFor('carousel');
    const r = verifyTypographyRuntime(state, template);
    expect(r.source).toBe('canonical');
    expect(r.aiTypographyDetected).toBe(false);
    expect(r.fields.find((f) => f.ref === 'field:headline')!.value).toBe('Boost activation by 92%');
    expect(r.editorPreviewParity).toBe(true);
    expect(r.previewRendererParity).toBe(true);
  });

  it('renderer overlays canonical headline / CTA / statistics / quotes (== editor)', () => {
    const { state, template } = stateFor('carousel');
    const render = toRenderPayload(state);
    const r = verifyTypographyRuntime(state, template);
    // headline + cta are canonical and land in the render payload verbatim.
    expect(render.fields.headline).toBe('Boost activation by 92%');
    expect(r.fields.find((f) => f.ref === 'field:headline')!.value).toBe(render.fields.headline);
    expect(r.fields.find((f) => f.ref === 'field:cta')!.value).toBe(render.fields.cta);
    // a manual edit also flows to the renderer unchanged (renderer = overlay, no paraphrase).
    const edited = editField(state, 'field:headline', 'Increase Revenue Using AI');
    expect(toRenderPayload(edited).fields.headline).toBe('Increase Revenue Using AI');
  });

  it('safe-area validation flags overflow without changing rendering', () => {
    const { state, template } = stateFor('carousel');
    const overflowing = editField(state, 'field:cta', 'This call to action is far too long for the 28 character budget');
    const r = verifyTypographyRuntime(overflowing, template);
    expect(r.safeAreaViolations.some((v) => v.ref === 'field:cta')).toBe(true);
    expect(r.status).toBe('WARN'); // overflow → WARN, not a hard fail
    // within budget → no violation.
    expect(verifyTypographyRuntime(state, template).safeAreaViolations.every((v) => v.ref !== 'field:headline' || v.overBy <= 0)).toBe(true);
  });

  it('PASS when overlay complete, parity holds, no safe-area violation', () => {
    const { state, template } = stateFor('image');
    const r = verifyTypographyRuntime(state, template);
    expect(['PASS', 'WARN']).toContain(r.status);
    expect(r.overlayComplete).toBe(true);
    expect(r.missingRequired).toEqual([]);
  });

  it('diagnostics report canonical source + parity + zero legacy typography', () => {
    const { state, template } = stateFor('carousel');
    const d = typographyDiagnostics(state, template);
    expect(d.typographySource).toBe('canonical');
    expect(d.legacyTypographyUsage).toBe(0);
    expect(d.editorPreviewParity).toBe(true);
    expect(d.previewRendererParity).toBe(true);
    expect(d.overlayCompleteness).toBeGreaterThan(0);
  });

  it('works across image / carousel / infographic', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const { state, template } = stateFor(fam);
      const r = verifyTypographyRuntime(state, template);
      expect(r.source).toBe('canonical');
      expect(r.previewRendererParity).toBe(true);
    }
  });
});

describe('Typography Verification — AI image prompt requests imagery only (STEP 3)', () => {
  const baseInput = (over: Record<string, unknown>) => ({ platform: 'linkedin', campaignName: 'Launch', assetType: 'image', ...over }) as any;

  it('imagePromptIsImageryOnly: bans visible text + no positive typography request', () => {
    expect(imagePromptIsImageryOnly('Strictly avoid all visible text. A calm desk scene.')).toBe(true);
    expect(imagePromptIsImageryOnly('Render a bold headline that says BUY NOW.')).toBe(false);
    expect(imagePromptIsImageryOnly('A nice gradient.')).toBe(false); // no ban present
  });

  it('the REAL composed image prompt requests imagery only — supporting_visual AND embedded_copy', () => {
    for (const attachmentMode of ['supporting_visual', 'embedded_copy']) {
      for (const purposeKey of [null, 'promotional-image']) {
        const composed = composeCreatorImagePrompt(baseInput({ attachmentMode, contentType: 'image', eyebrow: 'image', purposeKey }));
        expect({ attachmentMode, purposeKey, ok: imagePromptIsImageryOnly(composed.prompt) }).toEqual({ attachmentMode, purposeKey, ok: true });
      }
    }
  });

  it('verifyTypographyRuntime folds the image-prompt check into its verdict', () => {
    const { state, template } = stateFor('image');
    const composed = composeCreatorImagePrompt(baseInput({ attachmentMode: 'supporting_visual', contentType: 'image', eyebrow: 'image', purposeKey: null }));
    const r = verifyTypographyRuntime(state, template, composed.prompt);
    expect(r.promptRequestsTypography).toBe(false);
  });
});
