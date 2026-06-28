import {
  getSample, listSamples, listSamplesForGoal, sampleCount,
} from '../../../lib/creator-outcomes/marketingSample';
import { VISUAL_BLUEPRINTS } from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';

describe('CREATOR-082 — MarketingSampleDefinition (single source of truth)', () => {
  it('STEP 2 — one definition per sample; NO stored preview image / thumbnail field', () => {
    expect(sampleCount()).toBe(VISUAL_BLUEPRINTS.length);
    for (const b of VISUAL_BLUEPRINTS) {
      const s = getSample(b.id);
      expect(s).not.toBeNull();
      expect(s!.sampleId).toBe(b.id);
      // The definition shape — no thumbnail / previewImages anywhere.
      expect(Object.keys(s!)).toEqual([
        'sampleId', 'title', 'description', 'businessPurpose', 'businessGoal',
        'supportedAssetTypes', 'industryTags', 'audienceTags', 'previewImage',
        'designSystem', 'generationDNA', 'lockedRegions', 'editableRegions',
        'previewRecipe', 'generationRecipe', 'version',
      ]);
      // Exactly ONE canonical image field (no thumbnail / previewImages / coverImage / imageUrl).
      expect('thumbnail' in s!).toBe(false);
      expect('previewImages' in s!).toBe(false);
      expect('coverImage' in s!).toBe(false);
      expect('imageUrl' in s!).toBe(false);
      expect(typeof s!.previewImage).toBe('string');
      expect(s!.version).toBe(1);
      expect(s!.generationDNA.promptModifiers.length).toBeGreaterThan(10);
    }
  });

  it('STEP 7 — explicit locked vs editable regions (no overlap)', () => {
    const s = getSample('corporate')!;
    expect(s.lockedRegions).toEqual(expect.arrayContaining(['composition', 'typography structure', 'spacing', 'photography language']));
    expect(s.editableRegions).toEqual(expect.arrayContaining(['headline', 'CTA', 'logo', 'brand colors', 'product', 'pricing']));
    expect(s.lockedRegions.some((x) => s.editableRegions.includes(x))).toBe(false);
    // adaptation mirrors the regions (consumed by the pipeline).
    expect(s.generationDNA.adaptation.immutable).toEqual(s.lockedRegions);
    expect(s.generationDNA.adaptation.adaptable).toEqual(s.editableRegions);
  });

  it('STEP 5 — goal-aware library: different goals yield different definitions', () => {
    const educate = listSamplesForGoal('educate-audience').map((s) => s.sampleId).sort();
    const launch = listSamplesForGoal('launch-product').map((s) => s.sampleId).sort();
    expect(educate.length).toBeGreaterThan(0);
    expect(educate).not.toEqual(launch);
    expect(listSamplesForGoal('nope').length).toBe(listSamples().length);
  });
});
