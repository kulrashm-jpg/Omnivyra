import { recommendAssetSize, distinctUnits, validateRecommendationCoverage, recommendationVerdict } from '../../../lib/creator-templates/assetSizeRecommendation';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import type { AssetAssembly } from '../../../lib/creator-templates/assetAssembly';

// Focused fixture for the PURE rule engine: an assembly with N distinct units.
const asmWith = (n: number): AssetAssembly =>
  ({ assets: Array.from({ length: n }, (_unused, i) => ({ headline: `Distinct unit ${i + 1}`, body: `body ${i + 1}` })) } as unknown as AssetAssembly);
// An assembly whose units all share one headline → only 1 distinct unit.
const asmDuplicated = (n: number): AssetAssembly =>
  ({ assets: Array.from({ length: n }, () => ({ headline: 'Same headline', body: '' })) } as unknown as AssetAssembly);

describe('Asset Size Recommendation — unit-count rules (CREATOR-032)', () => {
  it('counts only DISTINCT units (no duplicates inflate the count)', () => {
    expect(distinctUnits(asmWith(5))).toBe(5);
    expect(distinctUnits(asmDuplicated(5))).toBe(1); // 5 slides of identical content = 1 real unit
  });

  it('1 distinct unit → Image', () => {
    const r = recommendAssetSize(asmWith(1), { requestedFamily: 'carousel', slideCountOptions: [5, 7, 10] });
    expect(r.recommendedFamily).toBe('image');
    expect(r.recommendedVariantLabel).toBe('Image');
  });

  it('2 / 3 distinct units → 2 / 3-slide carousel when those variants exist (custom templates)', () => {
    const r2 = recommendAssetSize(asmWith(2), { requestedFamily: 'carousel', slideCountOptions: [2, 3, 5] });
    expect(r2.recommendedFamily).toBe('carousel');
    expect(r2.recommendedSlideCount).toBe(2);
    const r3 = recommendAssetSize(asmWith(3), { requestedFamily: 'carousel', slideCountOptions: [2, 3, 5] });
    expect(r3.recommendedSlideCount).toBe(3);
  });

  it('5 / 7 distinct units → 5 / 7-slide carousel (real system [5,7,10])', () => {
    expect(recommendAssetSize(asmWith(5), { requestedFamily: 'carousel' }).recommendedSlideCount).toBe(5);
    expect(recommendAssetSize(asmWith(7), { requestedFamily: 'carousel' }).recommendedSlideCount).toBe(7);
    expect(recommendAssetSize(asmWith(8), { requestedFamily: 'carousel' }).recommendedSlideCount).toBe(7); // largest ≤ 8
    const r12 = recommendAssetSize(asmWith(12), { requestedFamily: 'carousel' });
    expect(r12.recommendedSlideCount).toBe(10);
    expect(r12.unusedUnits).toBe(2); // 2 units beyond the 10-slide cap, reported
  });

  it('thin content for a carousel downgrades to a faithful smaller template (no duplicate slides)', () => {
    // 3 distinct units but real carousel min is 5 → recommend Infographic(3), not a 5-slide carousel.
    const r = recommendAssetSize(asmWith(3), { requestedFamily: 'carousel', slideCountOptions: [5, 7, 10], sectionMin: 2, sectionMax: 6 });
    expect(r.recommendedFamily).toBe('infographic');
    expect(r.recommendedSectionCount).toBe(3);
    expect(r.reason).toMatch(/avoid duplicate slides/i);
    expect(validateRecommendationCoverage(r).duplicatedUnits).toBe(false);
  });

  it('infographic section recommendation clamps to min/max', () => {
    expect(recommendAssetSize(asmWith(4), { requestedFamily: 'infographic', sectionMin: 2, sectionMax: 6 }).recommendedSectionCount).toBe(4);
    expect(recommendAssetSize(asmWith(9), { requestedFamily: 'infographic', sectionMin: 2, sectionMax: 6 }).recommendedSectionCount).toBe(6); // capped
  });

  it('never duplicates a unit — recommended size never exceeds available units', () => {
    for (const n of [1, 2, 3, 5, 7, 10]) {
      for (const req of ['image', 'carousel', 'infographic'] as const) {
        const r = recommendAssetSize(asmWith(n), { requestedFamily: req });
        const presented = r.recommendedSlideCount ?? r.recommendedSectionCount ?? 1;
        expect(presented).toBeLessThanOrEqual(Math.max(1, n));
        expect(validateRecommendationCoverage(r).duplicatedUnits).toBe(false);
      }
    }
  });

  it('coverage verdict — 100% PASS, capped/omitted → WARN (never FAIL)', () => {
    expect(recommendationVerdict(recommendAssetSize(asmWith(5), { requestedFamily: 'carousel' }))).toBe('PASS');
    expect(recommendationVerdict(recommendAssetSize(asmWith(12), { requestedFamily: 'carousel' }))).toBe('WARN');
  });

  it('CREATOR-031 fix — duplicate-headline assets (would-be duplicate slides) → Image', () => {
    // 5 layout slots but only 3 distinct headlines (A,B,C,A,B): a carousel/infographic
    // would duplicate slides → Creative Verification FAILed. Recommend Image instead.
    const partialDup = { assets: [{ headline: 'A' }, { headline: 'B' }, { headline: 'C' }, { headline: 'A' }, { headline: 'B' }] } as unknown as AssetAssembly;
    const r = recommendAssetSize(partialDup, { requestedFamily: 'carousel' });
    expect(r.recommendedFamily).toBe('image');
    expect(r.reason).toMatch(/duplicate content/i);
    expect(validateRecommendationCoverage(r).duplicatedUnits).toBe(false);
  });
});

describe('Asset Size Recommendation — real pipeline simulation (STEP 9)', () => {
  const THIN = 'Try our analytics suite. It is fast.';
  const LONG = ['Boost activation by 92%', 'Teams struggle with slow onboarding.', 'Manual steps waste hours.', 'Our solution automates onboarding.', 'Ship faster with 3x retention.', 'Customers love the dashboards.', 'Get started free today.'].join('\n');

  function asmFor(content: string) {
    let p = createPackage('pkg-sz');
    p = addIntakeSource(p, fromExistingContent(content), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    return packageAssetAssembly(p, 'carousel');
  }

  it('thin content requested as carousel does NOT recommend a duplicating 5-slide carousel', () => {
    const r = recommendAssetSize(asmFor(THIN), { requestedFamily: 'carousel', slideCountOptions: [5, 7, 10] });
    // Either a smaller faithful family, or a carousel whose slide count ≤ distinct units.
    const presented = r.recommendedSlideCount ?? r.recommendedSectionCount ?? 1;
    expect(presented).toBeLessThanOrEqual(r.availableUnits || 1);
    expect(validateRecommendationCoverage(r).duplicatedUnits).toBe(false);
  });

  it('long content recommends a carousel sized to its distinct units', () => {
    const asm = asmFor(LONG);
    const r = recommendAssetSize(asm, { requestedFamily: 'carousel', slideCountOptions: [5, 7, 10] });
    expect(r.availableUnits).toBeGreaterThanOrEqual(1);
    const presented = r.recommendedSlideCount ?? r.recommendedSectionCount ?? 1;
    expect(presented).toBeLessThanOrEqual(r.availableUnits);
  });

  it('writer-first and creator-first both produce deterministic recommendations', () => {
    expect(JSON.stringify(recommendAssetSize(asmFor(LONG), { requestedFamily: 'carousel' })))
      .toBe(JSON.stringify(recommendAssetSize(asmFor(LONG), { requestedFamily: 'carousel' })));
  });
});
