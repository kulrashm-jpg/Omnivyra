import { DEFAULT_IMAGE_STYLE } from '../../../lib/creator-templates/imageStyle';
import { getTemplateById, resolveTemplateCreatorCardPatch } from '../../../lib/creator-templates';

/**
 * Platform-aware "Text Inside Image" — the SAME text template must adapt to
 * each platform's aspect ratio (the renderer routes template-authoritative text
 * overlays through the text-capable governance lane at the PLATFORM-NATIVE
 * canvas via imageStyle.canvas.byPlatform, not the fixed banner 16:9).
 *
 * The renderer routing itself needs sharp/fonts (exercised at runtime); here we
 * verify the canvas contract the feature depends on + that the template still
 * declares a single (aspect-ratio-agnostic) text lane.
 */

const aspect = (s: { width: number; height: number }) =>
  s.width > s.height ? 'landscape' : s.width < s.height ? 'portrait' : 'square';

describe('Platform-aware text image — canvas adapts per platform', () => {
  const c = DEFAULT_IMAGE_STYLE.canvas;

  it('exposes distinct platform-native canvases (square / portrait / landscape)', () => {
    expect(aspect(c.default)).toBe('square');                 // generic square
    expect(aspect(c.byPlatform.linkedin)).toBe('landscape');  // LinkedIn
    expect(aspect(c.byPlatform.x)).toBe('landscape');         // X
    expect(aspect(c.byPlatform.instagram)).toBe('portrait');  // Instagram feed
    expect(aspect(c.byPlatform.facebook)).toBe('portrait');   // Facebook
    expect(aspect(c.byPlatform.pinterest)).toBe('portrait');  // Pinterest
  });

  it('the SAME template renders at different dimensions per platform (no per-aspect template)', () => {
    const dims = ['linkedin', 'instagram', 'pinterest', 'x'].map((p) => c.byPlatform[p]);
    const distinct = new Set(dims.map((d) => `${d.width}x${d.height}`));
    expect(distinct.size).toBeGreaterThan(1); // adapts, not one-size-fits-all
  });

  it('banner canvas is UNCHANGED (16:9) — existing banner generation preserved', () => {
    expect(c.banner).toEqual({ width: 1600, height: 900 });
    expect(aspect(c.banner)).toBe('landscape');
  });

  it('every byPlatform canvas is a sane, non-zero size', () => {
    for (const [, dim] of Object.entries(c.byPlatform)) {
      expect(dim.width).toBeGreaterThan(0);
      expect(dim.height).toBeGreaterThan(0);
    }
  });
});

describe('Platform-aware text image — template stays aspect-ratio-agnostic', () => {
  it('text templates declare ONE text lane; platform (not the template) drives dimensions', () => {
    for (const id of ['sys-image-headline', 'sys-image-headline-sub-cta', 'sys-image-quote-author']) {
      const patch = resolveTemplateCreatorCardPatch(getTemplateById(id)!);
      expect(patch.writer_asset_type).toBe('banner'); // text-capable lane
      expect(patch.attachment_mode).toBe('embedded_copy');
      // No per-aspect / per-platform field on the contract — one template, all ratios.
      expect(patch.slide_count).toBeUndefined();
    }
  });

  it('logo-only template stays on the clean supporting_image lane', () => {
    const patch = resolveTemplateCreatorCardPatch(getTemplateById('sys-image-logo-only')!);
    expect(patch.writer_asset_type).toBe('supporting_image');
    expect(patch.attachment_mode).toBe('supporting_visual');
  });
});
