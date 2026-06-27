import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { initTemplateValues, type TemplateFieldValues } from '../../../lib/creator-templates/values';
import { editorFields, effectivePopulation, toRenderPayload } from '../../../lib/creator-templates/editorRuntime';
import {
  legacyPopulationFromValues, comparePopulations, migrateToEditorState, buildEditorMigration,
} from '../../../lib/creator-templates/editorMigration';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
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
function deterministicFor(family: TemplateAssetFamily) {
  let p = createPackage('pkg-m');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  return { assembly, population: populateTemplateFromAssembly(assembly, makeTemplate(family)) };
}

describe('Editor Migration — parity + lossless cutover (CREATOR-027)', () => {
  it('legacyPopulationFromValues maps typed templateValues into population shape', () => {
    const tpl = makeTemplate('carousel');
    const values: TemplateFieldValues = { fields: { headline: 'My typed headline', subheadline: '', cta: 'Buy now' }, slides: [{ title: 'Slide A', body: '' }] };
    const legacy = legacyPopulationFromValues(tpl, values);
    expect(legacy.fields.headline).toBe('My typed headline');
    expect(legacy.slides[0].title).toBe('Slide A');
    expect(legacy.coverage.cta).toBe(true);
    expect(legacy.metadata.source).toBe('legacy_template_values');
  });

  it('comparePopulations reports parity and surfaces mismatches (diagnostics only)', () => {
    const tpl = makeTemplate('carousel');
    const { population: det } = deterministicFor('carousel');
    // Identical typed values → parity 1, no mismatch.
    const same: TemplateFieldValues = { fields: { ...det.fields }, slides: det.slides.map((r) => ({ ...r })) };
    const pSame = comparePopulations(legacyPopulationFromValues(tpl, same), det);
    expect(pSame.identical).toBe(true);
    expect(pSame.parityScore).toBe(1);
    // Different typed headline → recorded as a mismatch, never thrown.
    const diff: TemplateFieldValues = { fields: { ...det.fields, headline: 'Different headline' } };
    const pDiff = comparePopulations(legacyPopulationFromValues(tpl, diff), det);
    expect(pDiff.identical).toBe(false);
    expect(pDiff.fieldMismatches.some((m) => m.ref === 'field:headline')).toBe(true);
    expect(pDiff.parityScore).toBeLessThan(1);
  });

  it('migration is lossless — user typed values become MANUAL, deterministic fills AUTO', () => {
    const { population: det, assembly } = deterministicFor('carousel');
    const values: TemplateFieldValues = { fields: { headline: 'User headline wins', subheadline: '', cta: '' } };
    const state = migrateToEditorState(det, values, assembly);
    const fields = editorFields(state);
    const headline = fields.find((f) => f.ref === 'field:headline')!;
    expect(headline.value).toBe('User headline wins');     // user input preserved
    expect(headline.owner).toBe('MANUAL');
    const cta = fields.find((f) => f.ref === 'field:cta')!;
    expect(cta.owner).toBe('AUTO');                         // not typed → deterministic canonical
    expect(cta.value).toBe(det.fields.cta);
  });

  it('the cutover generate/render payload originates from editorRuntime effective population', () => {
    const { population: det, assembly } = deterministicFor('carousel');
    const values: TemplateFieldValues = { fields: { headline: 'Final headline', subheadline: '', cta: '' } };
    const state = migrateToEditorState(det, values, assembly);
    const eff = effectivePopulation(state);
    const render = toRenderPayload(state);
    expect(eff.fields.headline).toBe('Final headline');
    expect(render.fields.headline).toBe('Final headline');  // renderer overlays exactly the editor value
    expect(render.fields).toEqual(eff.fields);
  });

  it('buildEditorMigration produces parity + a cutover-ready seeded state across families', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const tpl = makeTemplate(fam);
      const { population: det, assembly } = deterministicFor(fam);
      const legacyValues = initTemplateValues(tpl); // empty form (writer-first: nothing typed yet)
      const migration = buildEditorMigration({ template: tpl, legacyValues, deterministicPopulation: det, assembly });
      expect(migration.cutoverReady).toBe(true);
      expect(migration.parity).toBeDefined();
      // Empty legacy → 0 compared fields → parityScore defaults to 1 (nothing to contradict).
      expect(migration.parity.parityScore).toBe(1);
      // Seeded editor shows the deterministic canonical values (all AUTO).
      expect(editorFields(migration.state).every((f) => f.owner === 'AUTO')).toBe(true);
      expect(editorFields(migration.state).some((f) => f.value.length > 0)).toBe(true);
    }
  });

  it('determinism — same inputs produce identical migration', () => {
    const tpl = makeTemplate('carousel');
    const a = deterministicFor('carousel');
    const b = deterministicFor('carousel');
    const v: TemplateFieldValues = { fields: { headline: 'H', subheadline: '', cta: '' } };
    expect(JSON.stringify(buildEditorMigration({ template: tpl, legacyValues: v, deterministicPopulation: a.population, assembly: a.assembly }).state))
      .toBe(JSON.stringify(buildEditorMigration({ template: tpl, legacyValues: v, deterministicPopulation: b.population, assembly: b.assembly }).state));
  });
});
