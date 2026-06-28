import { resolveTemplateVariant, verifyVariantPreservation, derivableSlideCounts, derivableSectionCounts } from '../../../lib/creator-templates/templateVariantResolver';
import { recommendAssetSize } from '../../../lib/creator-templates/assetSizeRecommendation';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import type { AssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const field = (key: string, required = false, maxLength?: number): TemplateField =>
  ({ key, label: key, control: 'text', required, maxLength, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);

// A carousel "master" with the real-system [5,7,10] options + full metadata.
function carouselMaster(countOptions = [5, 7, 10]): CreatorTemplate {
  return {
    id: 'sys-carousel-master', assetFamily: 'carousel', name: 'Master Carousel', category: 'Educational', description: '',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#7c3aed', surface: '#0b1220' },
    carouselStyle: { theme: 'modern' } as unknown as CreatorTemplate['carouselStyle'],
    formDefinition: { fields: [field('cta', false, 28)], slides: { countOptions, defaultCount: countOptions[0], fields: [field('title', true, 80), field('body', false, 200)] } },
    renderingContract: { renderingContractVersion: 'creator-template-v1', family: 'carousel', writerAssetType: 'carousel', frameCount: countOptions[0] } as unknown as CreatorTemplate['renderingContract'],
    version: 1, status: 'published', ownership: 'system', tags: ['x'], metadata: {},
  } as unknown as CreatorTemplate;
}
function infographicMaster(min = 2, max = 8): CreatorTemplate {
  return {
    id: 'sys-ig-master', assetFamily: 'infographic', name: 'Master IG', category: 'Stats', description: '',
    visualLanguage: { densityBias: 'balanced', brandingIntensity: 'balanced', typographyWeight: 'lead', accent: '#0ea5e9', surface: '#0b1220' },
    infographicStyle: { theme: 'stats' } as unknown as CreatorTemplate['infographicStyle'],
    formDefinition: { fields: [field('headline', true, 80)], sections: { kind: 'repeatable', min, max, sectionLabel: 'Statistic', fields: [field('label', true, 60), field('value', false, 40)] } },
    renderingContract: { renderingContractVersion: 'creator-template-v1', family: 'infographic', writerAssetType: 'infographic' } as unknown as CreatorTemplate['renderingContract'],
    version: 1, status: 'published', ownership: 'system', tags: ['x'], metadata: {},
  } as unknown as CreatorTemplate;
}
const asmWith = (n: number): AssetAssembly => ({ assets: Array.from({ length: n }, (_u, i) => ({ headline: `Unit ${i + 1}`, body: `b${i + 1}` })) } as unknown as AssetAssembly);
const rec = (assembly: AssetAssembly, requestedFamily: TemplateAssetFamily, slideCountOptions?: number[], sectionMin?: number, sectionMax?: number) =>
  recommendAssetSize(assembly, { requestedFamily, slideCountOptions, sectionMin, sectionMax });

describe('Template Variant Resolver — resolution order (CREATOR-033)', () => {
  it('exact resolution when the master already supports the count', () => {
    const master = carouselMaster([5, 7, 10]);
    const r = resolveTemplateVariant({ recommendation: rec(asmWith(5), 'carousel'), requestedTemplate: master });
    expect(r.resolution).toBe('exact');
    expect(r.template.formDefinition.slides!.defaultCount).toBe(5);
  });

  it('derived variant when the count is in range but not an explicit option (3 slides from a [5,7,10] master)', () => {
    const master = carouselMaster([5, 7, 10]);
    // Offer the full derivable range so the recommendation picks 3.
    const r = resolveTemplateVariant({ recommendation: rec(asmWith(3), 'carousel', derivableSlideCounts(master)), requestedTemplate: master });
    expect(r.resolution).toBe('derived');
    expect(r.count).toBe(3);
    expect(r.template.formDefinition.slides!.defaultCount).toBe(3);
    expect(r.template.formDefinition.slides!.countOptions).toEqual([3]);
    expect(r.derivedFrom).toBe('sys-carousel-master');
  });

  it('supports 2–10 slide derivation deterministically', () => {
    const master = carouselMaster([5, 7, 10]);
    expect(derivableSlideCounts(master)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const r = resolveTemplateVariant({ recommendation: rec(asmWith(n), 'carousel', derivableSlideCounts(master)), requestedTemplate: master });
      expect(r.template.formDefinition.slides!.defaultCount).toBe(n);
      expect(verifyVariantPreservation(master, r.template).ok).toBe(true);
    }
  });

  it('supports 2–8 section derivation for infographics', () => {
    const master = infographicMaster(2, 8);
    expect(derivableSectionCounts(master)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    for (const n of [2, 4, 6, 8]) {
      const r = resolveTemplateVariant({ recommendation: rec(asmWith(n), 'infographic', undefined, 2, 8), requestedTemplate: master });
      expect(r.template.formDefinition.sections!.min).toBe(n);
      expect(r.template.formDefinition.sections!.max).toBe(n);
      expect(verifyVariantPreservation(master, r.template).ok).toBe(true);
    }
  });

  it('custom template compatibility — a 12-slide master derives 4/6/12 with no new code', () => {
    const custom = carouselMaster([4, 6, 12]);
    expect(derivableSlideCounts(custom)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const r4 = resolveTemplateVariant({ recommendation: rec(asmWith(4), 'carousel', derivableSlideCounts(custom)), requestedTemplate: custom });
    expect(r4.template.formDefinition.slides!.defaultCount).toBe(4);
    expect(r4.resolution).toBe('exact'); // 4 IS a custom option
    const r5 = resolveTemplateVariant({ recommendation: rec(asmWith(5), 'carousel', derivableSlideCounts(custom)), requestedTemplate: custom });
    expect(r5.resolution).toBe('derived'); // 5 not an option but in range
    expect(verifyVariantPreservation(custom, r5.template).ok).toBe(true);
  });
});

describe('Template Variant Resolver — preservation + Population compatibility (STEP 8/9)', () => {
  it('a derived variant preserves theme / branding / typography regions / safe areas / fields / contract', () => {
    const master = carouselMaster([5, 7, 10]);
    const derived = resolveTemplateVariant({ recommendation: rec(asmWith(3), 'carousel', derivableSlideCounts(master)), requestedTemplate: master }).template;
    const p = verifyVariantPreservation(master, derived);
    expect(p.ok).toBe(true);
    expect(p.preserved).toEqual({ theme: true, branding: true, typographyRegions: true, safeAreasFields: true, renderingContract: true, family: true });
    // Per-slide field defs (typography regions / component hierarchy) byte-identical.
    expect(JSON.stringify(derived.formDefinition.slides!.fields)).toBe(JSON.stringify(master.formDefinition.slides!.fields));
  });

  it('Template Population is untouched — it populates the derived template normally', () => {
    let pkg = createPackage('pkg-vr');
    pkg = addIntakeSource(pkg, fromExistingContent(['A', 'B', 'C', 'D', 'E'].join('\n')), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    const assembly = packageAssetAssembly(pkg, 'carousel');
    const master = carouselMaster([5, 7, 10]);
    const derived = resolveTemplateVariant({ recommendation: rec(assembly, 'carousel', derivableSlideCounts(master)), requestedTemplate: master }).template;
    // populateTemplateFromAssembly accepts the derived template unchanged.
    const pop = populateTemplateFromAssembly(assembly, derived);
    expect(Array.isArray(pop.slides)).toBe(true);
    expect(pop.templateId).toBe(derived.id);
  });

  it('family-change (recommendation → Image for thin/duplicated content) is signalled, not derived', () => {
    const master = carouselMaster([5, 7, 10]);
    const dupAssembly = { assets: [{ headline: 'A' }, { headline: 'B' }, { headline: 'A' }, { headline: 'B' }, { headline: 'A' }] } as unknown as AssetAssembly;
    const r = resolveTemplateVariant({ recommendation: rec(dupAssembly, 'carousel'), requestedTemplate: master });
    expect(r.family).toBe('image');
    expect(r.resolution).toBe('family-change');
  });

  it('deterministic — same inputs resolve identically', () => {
    const master = carouselMaster([5, 7, 10]);
    const a = resolveTemplateVariant({ recommendation: rec(asmWith(6), 'carousel', derivableSlideCounts(master)), requestedTemplate: master });
    const b = resolveTemplateVariant({ recommendation: rec(asmWith(6), 'carousel', derivableSlideCounts(master)), requestedTemplate: master });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
