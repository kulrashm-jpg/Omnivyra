import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import {
  createEditorState, editorFields, editField, resetField, regenerateContent,
  applyUpstreamPopulation, effectivePopulation, toPreviewModel, toRenderPayload,
  editorSummary, editorDiagnostics, type EditorState,
} from '../../../lib/creator-templates/editorRuntime';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');

const field = (key: string, required = false): TemplateField =>
  ({ key, label: key, control: 'text', required, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true), field('subheadline'), field('cta', true)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true), field('body')] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true), field('value')] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 2, formDefinition } as unknown as CreatorTemplate;
}
function stateFor(family: TemplateAssetFamily = 'carousel', content = CONTENT): EditorState {
  let p = createPackage('pkg-e');
  p = addIntakeSource(p, fromExistingContent(content), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  return createEditorState(population, assembly);
}
const fieldByRef = (s: EditorState, ref: string) => editorFields(s).find((f) => f.ref === ref)!;

describe('Editor Runtime — canonical populated values (no placeholders)', () => {
  it('headline / supporting / CTA fields show populated values, not placeholders', () => {
    const s = stateFor('carousel');
    const headline = fieldByRef(s, 'field:headline');
    expect(headline.value).toBe('Boost activation by 92%');
    expect(headline.populated).toBe(true);
    expect(headline.value).not.toBe(headline.placeholder);
    const cta = fieldByRef(s, 'field:cta');
    expect(cta.value.length).toBeGreaterThan(0);
    expect(cta.provenance.planner).toBe('AssetAssembly:Conversion');
  });

  it('carousel slides + infographic sections are populated', () => {
    const carousel = editorFields(stateFor('carousel')).filter((f) => f.location === 'slide');
    expect(carousel.length).toBeGreaterThan(0);
    expect(carousel.some((f) => f.value.includes('Boost activation by 92%'))).toBe(true);
    const sections = editorFields(stateFor('infographic')).filter((f) => f.location === 'section');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('a placeholder only appears when the canonical value is genuinely empty', () => {
    const s = stateFor('carousel');
    const empties = editorFields(s).filter((f) => !f.value.trim());
    for (const f of empties) expect(f.placeholder.length).toBeGreaterThan(0);
    const filled = editorFields(s).filter((f) => f.value.trim());
    for (const f of filled) expect(f.value).not.toBe(f.placeholder);
  });

  it('every field carries provenance (planner + mapping)', () => {
    for (const f of editorFields(stateFor('carousel'))) {
      expect(f.provenance.mapping).toContain(f.key);
      expect(['AssetAssembly:Conversion', 'AssetAssembly:VisualMessaging', 'AssetAssembly:StoryBlueprint', 'derived']).toContain(f.provenance.planner);
    }
  });
});

describe('Editor Runtime — AUTO / MANUAL / RESET ownership', () => {
  it('fields start AUTO; editing flips to MANUAL', () => {
    const s = stateFor('carousel');
    expect(fieldByRef(s, 'field:headline').owner).toBe('AUTO');
    const edited = editField(s, 'field:headline', 'Increase Revenue Using AI');
    expect(fieldByRef(edited, 'field:headline').owner).toBe('MANUAL');
    expect(fieldByRef(edited, 'field:headline').value).toBe('Increase Revenue Using AI');
  });

  it('upstream re-population never overwrites MANUAL fields, refreshes AUTO fields', () => {
    const s = stateFor('carousel');
    const edited = editField(s, 'field:headline', 'My manual headline');
    // New upstream content → new population (different main message).
    const next = stateFor('carousel', 'Cut churn by 40%\nNew approach to retention.\nTry it now.');
    const synced = applyUpstreamPopulation(edited, next.population, next.assembly);
    expect(fieldByRef(synced, 'field:headline').owner).toBe('MANUAL');
    expect(fieldByRef(synced, 'field:headline').value).toBe('My manual headline');       // preserved
    const cta = fieldByRef(synced, 'field:cta');
    expect(cta.owner).toBe('AUTO');                                                       // AUTO followed upstream
    expect(cta.canonicalValue).toBe(next.population.fields.cta);
  });

  it('Reset restores the canonical value; Regenerate clears all overrides', () => {
    const s = stateFor('carousel');
    const edited = editField(editField(s, 'field:headline', 'X'), 'field:cta', 'Y');
    const reset = resetField(edited, 'field:headline');
    expect(fieldByRef(reset, 'field:headline').owner).toBe('AUTO');
    expect(fieldByRef(reset, 'field:headline').value).toBe('Boost activation by 92%');
    expect(fieldByRef(reset, 'field:cta').owner).toBe('MANUAL');                          // unaffected
    const regen = regenerateContent(edited);
    expect(editorFields(regen).every((f) => f.owner === 'AUTO')).toBe(true);
  });
});

describe('Editor Runtime — Editor ↔ Preview ↔ Renderer parity', () => {
  it('preview and renderer consume the SAME effective values the editor shows', () => {
    const s = editField(stateFor('carousel'), 'field:headline', 'Increase Revenue Using AI');
    const eff = effectivePopulation(s);
    expect(eff.fields.headline).toBe('Increase Revenue Using AI');                        // editor edit flows through
    const preview = toPreviewModel(s);
    const render = toRenderPayload(s);
    expect(preview.fields).toEqual(eff.fields);
    expect(render.fields).toEqual(eff.fields);
    expect(render.slides).toEqual(eff.slides);
    // What the editor shows == what the renderer overlays — no paraphrasing.
    expect(fieldByRef(s, 'field:headline').value).toBe(render.fields.headline);
  });

  it('diagnostics report completeness, ownership counts, and deterministic parity', () => {
    const s = editField(stateFor('carousel'), 'field:headline', 'Manual');
    const d = editorDiagnostics(s);
    expect(d.editorPreviewParity).toBe(true);
    expect(d.previewRendererParity).toBe(true);
    expect(d.syncHealth).toBe('OK');
    expect(d.manualFields).toBe(1);
    expect(d.autoFields).toBeGreaterThan(0);
    expect(d.overriddenFields).toContain('field:headline');
    expect(d.provenanceComplete).toBe(true);
    expect(d.populationCompleteness).toBeGreaterThan(0);
  });
});

describe('Editor Runtime — summary + cross-family + determinism', () => {
  it('summary surfaces the full planner chain (read-only)', () => {
    const s = stateFor('carousel');
    const sum = editorSummary(s);
    expect(sum.messageFoundation).toBe('Boost activation by 92%');
    expect(sum.conversionGoal).toBeTruthy();
    expect(sum.storyBlueprint).toBeTruthy();
    expect(sum.template).toBe('tpl-carousel');
    expect(sum.templateFamily).toBe('carousel');
    expect(sum.overrideCount).toBe(0);
    expect(sum.wordCount).toBeGreaterThan(0);
    expect(sum.contentArchitecture.length).toBeGreaterThan(0);
    expect(editorSummary(editField(s, 'field:headline', 'X')).overrideCount).toBe(1);
  });

  it('works for image / carousel / infographic and is deterministic', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const a = stateFor(fam);
      const b = stateFor(fam);
      expect(JSON.stringify(editorFields(a))).toBe(JSON.stringify(editorFields(b)));
      expect(editorFields(a).length).toBeGreaterThan(0);
    }
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels)', () => {
    const blob = JSON.stringify(editorFields(stateFor('carousel'))).toLowerCase();
    for (const f of ['rgb', 'hex', 'px', 'font', 'pixel', 'coordinate', 'color']) expect(blob.includes(f)).toBe(false);
  });
});
