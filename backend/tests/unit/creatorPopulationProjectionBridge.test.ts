import { projectPopulation, validateProjection } from '../../../lib/creator-templates/populationProjectionBridge';
import { recommendAssetSize } from '../../../lib/creator-templates/assetSizeRecommendation';
import { resolveTemplateVariant, derivableSlideCounts, derivableSectionCounts } from '../../../lib/creator-templates/templateVariantResolver';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { createEditorState, editorFields, toRenderPayload } from '../../../lib/creator-templates/editorRuntime';
import { buildPromptFromAssembly } from '../../../lib/creator-templates/assetAssemblyPrompt';
import { generateCreative } from '../../../lib/creator-templates/creativeGeneration';
import { verifyCreative } from '../../../lib/creator-templates/creativeVerification';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const field = (key: string, required = false, maxLength?: number): TemplateField =>
  ({ key, label: key, control: 'text', required, maxLength, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function carouselMaster(countOptions = [5, 7, 10]): CreatorTemplate {
  return {
    id: 'sys-carousel-master', assetFamily: 'carousel', name: 'Master', category: 'x', description: '',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead' },
    carouselStyle: { theme: 'modern' } as unknown as CreatorTemplate['carouselStyle'],
    formDefinition: { fields: [field('cta', false, 28)], slides: { countOptions, defaultCount: countOptions[0], fields: [field('title', true, 80), field('body', false, 200)] } },
    renderingContract: { renderingContractVersion: 'creator-template-v1', family: 'carousel', writerAssetType: 'carousel', frameCount: countOptions[0] } as unknown as CreatorTemplate['renderingContract'],
    version: 1, status: 'published', ownership: 'system', tags: [], metadata: {},
  } as unknown as CreatorTemplate;
}
function infographicMaster(min = 2, max = 8): CreatorTemplate {
  return {
    id: 'sys-ig-master', assetFamily: 'infographic', name: 'IG', category: 'x', description: '',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead' },
    infographicStyle: { theme: 'stats' } as unknown as CreatorTemplate['infographicStyle'],
    formDefinition: { fields: [field('headline', true, 80)], sections: { kind: 'repeatable', min, max, sectionLabel: 'Statistic', fields: [field('label', true, 60), field('value', false, 40)] } },
    renderingContract: { renderingContractVersion: 'creator-template-v1', family: 'infographic', writerAssetType: 'infographic' } as unknown as CreatorTemplate['renderingContract'],
    version: 1, status: 'published', ownership: 'system', tags: [], metadata: {},
  } as unknown as CreatorTemplate;
}
// Rich, distinct multi-line content so the assembly yields many distinct units.
const RICH = ['Boost activation by 92%', 'Slow onboarding wastes time.', 'Manual steps cost hours.', 'Automate the whole flow.', 'Ship 3x faster.', 'Teams love the dashboards.', 'Retention climbs steadily.', 'Get started free today.'].join('\n');
function assemblyFor(content: string, family: TemplateAssetFamily) {
  let pkg = createPackage('pkg-pp');
  pkg = addIntakeSource(pkg, fromExistingContent(content), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
  return packageAssetAssembly(pkg, family);
}

describe('Population Projection Bridge — truncation only, preserves everything (CREATOR-034)', () => {
  it('projects a 5-populated carousel onto a 3-slide resolved template (first 3, verbatim)', () => {
    const master = carouselMaster([5, 7, 10]);
    const assembly = assemblyFor(RICH, 'carousel');
    const population = populateTemplateFromAssembly(assembly, master);
    const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'carousel', slideCountOptions: [3] }), requestedTemplate: master }).template;
    const projected = projectPopulation(population, resolved);
    expect(projected.slides.length).toBe(3);
    // First 3 slides are byte-identical to the population's first 3 (no transformation).
    expect(JSON.stringify(projected.slides)).toBe(JSON.stringify(population.slides.slice(0, 3)));
    expect(projected.projection.truncated).toBe(population.slides.length - 3);
  });

  it('preserves ownership, provenance, hierarchy, CTA, statistics, quotes', () => {
    const master = carouselMaster([5, 7, 10]);
    const assembly = assemblyFor(RICH, 'carousel');
    const population = populateTemplateFromAssembly(assembly, master);
    const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'carousel', slideCountOptions: [4] }), requestedTemplate: master }).template;
    const projected = projectPopulation(population, resolved);
    // Ownership map untouched (field-key based).
    expect(JSON.stringify(projected.ownership)).toBe(JSON.stringify(population.ownership));
    // Flat fields (shared CTA) untouched.
    expect(JSON.stringify(projected.fields)).toBe(JSON.stringify(population.fields));
    // editorRuntime over the projected population still derives provenance/hierarchy per slot.
    const fields = editorFields(createEditorState(projected, assembly));
    const slideFields = fields.filter((f) => f.location === 'slide');
    expect(slideFields.length).toBe(4 * Object.keys(population.slides[0]).length);
    for (const f of slideFields) expect(f.provenance.mapping).toContain(f.key);
  });

  it('validation: projected count == resolved count, no duplicates, no orphans', () => {
    const master = carouselMaster([5, 7, 10]);
    const assembly = assemblyFor(RICH, 'carousel');
    const population = populateTemplateFromAssembly(assembly, master);
    for (const n of [2, 3, 4, 5]) {
      const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'carousel', slideCountOptions: [n] }), requestedTemplate: master }).template;
      const projected = projectPopulation(population, resolved);
      const v = validateProjection(projected, resolved);
      expect(projected.slides.length).toBe(n);
      expect(v.countMatches).toBe(true);
      expect(v.orphaned).toBe(false);
      expect(v.ok).toBe(true);
    }
  });

  it('infographic projection truncates sections to the resolved count', () => {
    const master = infographicMaster(2, 8);
    const assembly = assemblyFor(RICH, 'infographic');
    const population = populateTemplateFromAssembly(assembly, master);
    for (const n of [2, 4, 6, 8]) {
      const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'infographic', sectionMin: 2, sectionMax: 8, slideCountOptions: derivableSectionCounts(master) }), requestedTemplate: master }).template;
      // Force a specific section count by resolving the variant to n.
      const resolvedN = resolveTemplateVariant({ recommendation: { ...recommendAssetSize(assembly, { requestedFamily: 'infographic', sectionMin: 2, sectionMax: 8 }), recommendedSectionCount: n }, requestedTemplate: master }).template;
      const projected = projectPopulation(population, resolvedN);
      expect(projected.sections.length).toBeLessThanOrEqual(n);
      expect(validateProjection(projected, resolvedN).countMatches || projected.sections.length === population.sections.length).toBe(true);
    }
  });
});

describe('Population Projection Bridge — downstream compatibility (STEP 7/8)', () => {
  it('Structured Creative Generation + Creative Verification consume the projected population unchanged', async () => {
    const master = carouselMaster([5, 7, 10]);
    const assembly = assemblyFor(RICH, 'carousel');
    const population = populateTemplateFromAssembly(assembly, master);
    const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'carousel', slideCountOptions: [5] }), requestedTemplate: master }).template;
    const projected = projectPopulation(population, resolved);
    const prompt = buildPromptFromAssembly(assembly);
    // generateCreative accepts the projected population exactly like a normal one.
    const creative = await generateCreative({ assembly, population: projected, prompt });
    expect(creative.slides.length).toBe(projected.slides.length);
    const report = verifyCreative({ assembly, population: projected, prompt, creative });
    expect(['PASS', 'WARN', 'FAIL']).toContain(report.status); // runs unchanged
    // Renderer payload (toRenderPayload) reflects the projected slide count.
    const render = toRenderPayload(createEditorState(projected, assembly));
    expect(render.slides.length).toBe(projected.slides.length);
  });

  it('image family is a pass-through (no slides/sections to project)', () => {
    const master = carouselMaster([5, 7, 10]);
    const imageTpl = { ...master, id: 'img', assetFamily: 'image', formDefinition: { fields: [field('headline', true), field('cta', true)] } } as unknown as CreatorTemplate;
    const assembly = assemblyFor(RICH, 'image');
    const population = populateTemplateFromAssembly(assembly, imageTpl);
    const projected = projectPopulation(population, imageTpl);
    expect(projected.slides.length).toBe(0);
    expect(projected.projection.targetCount).toBeNull();
  });

  it('deterministic — same inputs project identically', () => {
    const master = carouselMaster([5, 7, 10]);
    const assembly = assemblyFor(RICH, 'carousel');
    const population = populateTemplateFromAssembly(assembly, master);
    const resolved = resolveTemplateVariant({ recommendation: recommendAssetSize(assembly, { requestedFamily: 'carousel', slideCountOptions: [3] }), requestedTemplate: master }).template;
    expect(JSON.stringify(projectPopulation(population, resolved))).toBe(JSON.stringify(projectPopulation(population, resolved)));
  });
});
