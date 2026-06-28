import { getBlueprintPreview, blueprintHasRealCover } from '../../../lib/creator-outcomes/blueprintPreview';
import { VISUAL_BLUEPRINTS } from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';
import { getShowcasesByVisualStyle } from '../../../lib/creator-outcomes/creatorShowcaseRepository';

describe('CREATOR-056 — Blueprint preview model', () => {
  it('STEP 2 — every blueprint has a complete descriptive preview', () => {
    for (const b of VISUAL_BLUEPRINTS) {
      const p = getBlueprintPreview(b.id);
      expect(p).not.toBeNull();
      expect(p!.blueprintId).toBe(b.id);
      expect(p!.styleDescription.length).toBeGreaterThan(3);
      expect(p!.visualKeywords.length).toBeGreaterThan(0);
      expect(p!.compositionNotes.length).toBeGreaterThan(3);
      expect(p!.cameraStyle.length).toBeGreaterThan(3);
      expect(p!.lighting.length).toBeGreaterThan(3);
      expect(p!.colorPalette.every((c) => /^#/.test(c))).toBe(true);
      expect(p!.subjectExamples.length).toBeGreaterThan(0);     // describes the style in words
      expect(Array.isArray(p!.industryExamples)).toBe(true);
      // Real images come from the curated repo (empty until populated) — never fabricated.
      expect(typeof p!.coverImage).toBe('string');
      expect(Array.isArray(p!.gallery)).toBe(true);
      for (const u of p!.gallery) expect(u.length).toBeGreaterThan(0);
    }
  });

  it('STEP 3 — highlighted directions carry style-specific subjects', () => {
    expect(getBlueprintPreview('graffiti')!.subjectExamples.join(' ').toLowerCase()).toMatch(/mural|street|tag/);
    expect(getBlueprintPreview('anime')!.subjectExamples.join(' ').toLowerCase()).toMatch(/anime|cel|pose/);
    expect(getBlueprintPreview('dashboard')!.subjectExamples.join(' ').toLowerCase()).toMatch(/dashboard|kpi|chart/);
    expect(getBlueprintPreview('watercolor')!.subjectExamples.join(' ').toLowerCase()).toMatch(/watercolor|painted|wash/);
  });

  it('cover/gallery come from the repository (empty baseline) and never throw', () => {
    expect(getShowcasesByVisualStyle('corporate')).toEqual([]);   // empty until curated
    expect(blueprintHasRealCover('corporate')).toBe(false);
    expect(getBlueprintPreview('does-not-exist')).toBeNull();
  });
});
