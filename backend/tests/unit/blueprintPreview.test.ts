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

  it('cover/gallery come from the curated showcase repository and never throw', () => {
    // Curation shipped in 2911c608: content/creator-showcases/showcases.json now
    // carries exactly one `corporate` showcase, so the previous "empty until
    // curated" baseline is obsolete. Asserted exactly — the identity of the
    // curated entry — rather than a `length > 0` weakening.
    const corporate = getShowcasesByVisualStyle('corporate');
    expect(corporate.map((s) => s.id)).toEqual(['corporate-1']);
    expect(corporate[0]).toEqual(expect.objectContaining({
      id: 'corporate-1',
      templateId: 'corporate',
      visualStyle: 'corporate',
      family: 'image',
      thumbnailUrl: '/creator-showcases/corporate/preview.webp',
    }));

    // `coverImage` is `shows[0].thumbnailUrl` and `gallery` maps
    // `previewUrl || thumbnailUrl` (blueprintPreview.ts:86-87), so a curated
    // showcase makes the cover real — the exact inverse of the empty baseline.
    const preview = getBlueprintPreview('corporate');
    expect(preview?.coverImage).toBe('/creator-showcases/corporate/preview.webp');
    expect(preview?.gallery).toEqual(['/creator-showcases/corporate/preview.webp']);
    expect(blueprintHasRealCover('corporate')).toBe(true);

    // Unknown blueprint still resolves to null rather than throwing.
    expect(getBlueprintPreview('does-not-exist')).toBeNull();
  });
});
