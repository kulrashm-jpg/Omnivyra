import { buildCreatorDiagnosticReport } from '../../services/creator/creatorDiagnosticReport';

const cleanVisual = { passed: true, failures: [], slideCount: undefined };

function base(overrides: Partial<Parameters<typeof buildCreatorDiagnosticReport>[0]> = {}) {
  return buildCreatorDiagnosticReport({
    assetType: 'image',
    platform: 'linkedin',
    companyId: 'co-1',
    durationMs: 4200,
    template: { id: 'sys-image-headline', name: 'Bold Headline', version: 1, assetFamily: 'image', renderingContractVersion: 'creator-template-v1' },
    companyContext: { description: 'A RevOps platform', products: ['Router'], positioning: 'Fastest routing' },
    brandVoice: { tone: 'confident', prohibitedPhrases: ['synergy'] },
    contentViolations: [],
    renderMetadata: { width: 1200, height: 675, platform: 'linkedin', platform_visual_profile: { preferredTypographyScale: 'standard' }, overlay_quality: { preset: 'balanced', flags: [] }, visual_validation: cleanVisual },
    ...overrides,
  });
}

describe('Creator Diagnostic Report — summaries', () => {
  it('reports generation + template + context source summaries', () => {
    const r = base();
    expect(r.reportVersion).toBe('creator-diagnostic-v1');
    expect(r.generation).toMatchObject({ assetType: 'image', platform: 'linkedin', companyId: 'co-1', durationMs: 4200 });
    expect(r.template).toMatchObject({ id: 'sys-image-headline', name: 'Bold Headline', version: 1, renderingContractVersion: 'creator-template-v1' });
    expect(r.context.companyFacets).toEqual(expect.arrayContaining(['Company Profile', 'Products', 'Positioning']));
    expect(r.context.brandFacets).toEqual(expect.arrayContaining(['Brand Voice', 'Forbidden Words']));
    expect(r.context.sourcesUsed.length).toBeGreaterThan(0);
  });

  it('reports rendering profile from render metadata', () => {
    const r = base();
    expect(r.rendering).toMatchObject({ width: 1200, height: 675, platform: 'linkedin', typographyProfile: 'standard', layoutProfile: 'balanced' });
  });

  it('clean asset → all visual checks PASS and high scores', () => {
    const r = base();
    expect(r.visualValidation.passed).toBe(true);
    expect(Object.values(r.visualValidation.checks)).not.toContain('FAIL');
    expect(r.scores.visualQuality.value).toBe(100);
    expect(r.scores.overallReadiness.value).toBeGreaterThanOrEqual(95);
    expect(r.scores.contentQuality.reason).toMatch(/no content violations/i);
  });
});

describe('Creator Diagnostic Report — content validation + repair', () => {
  it('summarizes forbidden/claim/cta/fabricated repairs and lowers scores', () => {
    const r = base({
      contentViolations: [
        { type: 'forbidden_phrase', detail: 'synergy' },
        { type: 'prohibited_claim', detail: 'cures all' },
        { type: 'banned_cta', detail: 'click here' },
        { type: 'fabricated_claim', detail: 'world-class' },
        { type: 'missing_required_term', detail: 'Acme' },
      ],
    });
    expect(r.contentValidation).toMatchObject({ forbiddenWordsRepaired: 1, prohibitedClaimsRemoved: 1, ctaNormalized: 1, fabricatedClaimsRemoved: 1, missingRequiredTerms: ['Acme'] });
    expect(r.scores.contentQuality.value).toBeLessThan(100);
    expect(r.scores.brandCompliance.value).toBeLessThan(100);
    expect(r.repair.occurred).toBe(true);
    expect(r.repair.reasons).toEqual(expect.arrayContaining(['forbidden words removed', 'prohibited claims removed']));
  });

  it('no brand voice → brand compliance is 100 with explanation', () => {
    const r = base({ brandVoice: {}, contentViolations: [] });
    expect(r.scores.brandCompliance.value).toBe(100);
    expect(r.scores.brandCompliance.reason).toMatch(/no brand constraints/i);
  });
});

describe('Creator Diagnostic Report — visual validation + readiness gating', () => {
  it('marks failing checks and caps overall readiness when visual fails', () => {
    const r = base({
      renderMetadata: {
        width: 1200, height: 675,
        visual_repair_applied: true,
        visual_validation: { passed: false, failures: [{ category: 'text_fit', flag: 'severe_layout_overflow_risk' }, { category: 'typography', flag: 'headline_likely_unreadable_mobile' }], slideCount: undefined },
      },
    });
    expect(r.visualValidation.passed).toBe(false);
    expect(r.visualValidation.checks.textFit).toBe('FAIL');
    expect(r.visualValidation.checks.typography).toBe('FAIL');
    expect(r.visualValidation.checks.contrast).toBe('PASS');
    expect(r.scores.visualQuality.value).toBeLessThan(100);
    expect(r.scores.readability.value).toBeLessThan(100);
    expect(r.scores.overallReadiness.value).toBeLessThanOrEqual(60);
    expect(r.repair.reRendered).toBe(true);
  });

  it('carousel validates slides — a per-slide failure marks carouselSlides FAIL', () => {
    const r = base({
      assetType: 'carousel',
      renderMetadata: { visual_validation: { passed: false, failures: [{ category: 'text_fit', flag: 'x', slide: 2 }], slideCount: 5 } },
    });
    expect(r.visualValidation.checks.carouselSlides).toBe('FAIL');
    expect(r.visualValidation.slideCount).toBe(5);
  });

  it('infographic density check is applicable only for infographic', () => {
    expect(base().visualValidation.checks.infographicDensity).toBe('N/A');
    const r = base({ assetType: 'infographic', renderMetadata: { visual_validation: { passed: false, failures: [{ category: 'text_fit', flag: 'too_many_sections' }] } } });
    expect(r.visualValidation.checks.infographicDensity).toBe('FAIL');
  });
});
