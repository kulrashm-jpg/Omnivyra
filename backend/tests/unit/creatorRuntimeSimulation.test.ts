import { simulateCreatorRuntime, type SimInput } from '../../../lib/creator-templates/runtimeSimulation';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { createEditorState } from '../../../lib/creator-templates/editorRuntime';
import { verifyTypographyRuntime } from '../../../lib/creator-templates/typographyVerification';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const WRITER = ['Boost activation by 92%', 'Teams struggle with slow onboarding.', 'Our solution automates it. 3x retention.', '"It changed everything." — Jane Doe, CEO.', 'Get started free.'].join('\n');
const AI = 'Announce our analytics suite. 4x faster reporting. Try it free.';
const VOICE = 'so basically we cut reporting time by 4x and teams love it you should try it free';
const BLANK = '';

const field = (key: string, required = false, maxLength?: number): TemplateField =>
  ({ key, label: key, control: 'text', required, maxLength, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true, 80), field('subheadline', false, 120), field('cta', true, 28)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true, 80), field('body', false, 200)] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true, 60), field('value', false, 40)] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 1, formDefinition } as unknown as CreatorTemplate;
}
const inp = (entryPoint: string, family: TemplateAssetFamily, sourceText: string): SimInput => ({ entryPoint, family, template: makeTemplate(family), sourceText });

const FAMILIES: TemplateAssetFamily[] = ['image', 'carousel', 'infographic'];
const ENTRIES: Array<[string, string]> = [
  ['Writer', WRITER], ['AI Text', AI], ['Voice', VOICE], ['Existing Content', WRITER], ['Writer Library', WRITER],
  ['Campaign', AI], ['Preview', WRITER], ['Regeneration', AI], ['Batch', WRITER],
];

describe('Runtime Simulation — every entry point × family (CREATOR-031)', () => {
  const matrix: Array<{ name: string; input: SimInput }> = [];
  for (const [entry, text] of ENTRIES) for (const fam of FAMILIES) matrix.push({ name: `${entry} → ${fam}`, input: inp(entry, fam, text) });

  it.each(matrix)('$name executes end-to-end with zero integration gaps', async ({ input }) => {
    const r = await simulateCreatorRuntime(input);
    expect({ flow: r.entryPoint, family: r.family, gaps: r.gaps }).toEqual({ flow: r.entryPoint, family: r.family, gaps: [] });
    expect(r.metrics.parityScore).toBe(1);             // editor == preview == render payload
    expect(r.metrics.legacyUsage).toBe(0);             // no AI typography / legacy
    expect(r.metrics.duplicateOwnership).toBe(0);
    expect(r.ok).toBe(true);
    // Every canonical stage present, none skipped.
    for (const stage of ['Message Foundation', 'Asset Assembly', 'Template Population', 'editorRuntime', 'Typography Verification', 'Creative Verification', 'Renderer Payload']) {
      expect(r.trace).toContain(stage);
    }
  });

  it('blank editor (no content) still runs deterministically without crashing', async () => {
    const r = await simulateCreatorRuntime(inp('Blank', 'image', BLANK));
    expect(r.trace).toContain('Renderer Payload');
    expect(r.metrics.parityScore).toBe(1); // editor == preview == render even when empty
  });
});

describe('Runtime Simulation — failure injection (STEP 8)', () => {
  // Build a population then blank a required field → verification must catch it.
  function stateWithBlankedField(family: TemplateAssetFamily, blankKey: string) {
    let p = createPackage('pkg-fi');
    p = addIntakeSource(p, fromExistingContent(WRITER), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    const assembly = packageAssetAssembly(p, family);
    const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
    // Inject the failure: blank a required field in the population.
    if (population.fields[blankKey] !== undefined) population.fields[blankKey] = '';
    return { state: createEditorState(population, assembly), template: makeTemplate(family) };
  }

  it('missing required headline is caught by Typography Verification (overlay incomplete)', () => {
    const { state, template } = stateWithBlankedField('image', 'headline');
    const r = verifyTypographyRuntime(state, template);
    expect(r.overlayComplete).toBe(false);
    expect(r.missingRequired).toContain('field:headline');
    expect(r.status).toBe('FAIL');
  });

  it('missing required CTA is caught (renderer payload would be blocked)', () => {
    const { state, template } = stateWithBlankedField('image', 'cta');
    const r = verifyTypographyRuntime(state, template);
    expect(r.missingRequired).toContain('field:cta');
    expect(r.status).toBe('FAIL');
  });
});

describe('Runtime Simulation — metrics + coverage report (STEP 9)', () => {
  it('produces a complete metrics record per flow', async () => {
    const r = await simulateCreatorRuntime(inp('Writer', 'carousel', WRITER));
    expect(r.metrics.stages).toBeGreaterThan(8);
    expect(r.metrics.coverage).toBeGreaterThan(0);
    expect(r.metrics.typographyCompleteness).toBeGreaterThan(0);
    expect(['PASS', 'WARN']).toContain(r.metrics.typographyStatus);
    expect(r.metrics.autoFields).toBeGreaterThan(0);
    expect(r.metrics.manualFields).toBe(0); // simulation seeds no manual edits
  });
});
